// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Examinee, OperationSchedule } from "../../shared/api/examinees";
import type { PseudonymAssignment } from "../../shared/api/pseudonyms";
import type { PrinterService } from "../printer/PrinterService";
import type { PrinterDiagnostic } from "../printer/printer.types";
import { useOperationLabelPrint } from "./useOperationLabelPrint";

const api = vi.hoisted(() => ({
  createPrintJob: vi.fn(),
  completePrintJob: vi.fn(),
}));

vi.mock("../../shared/api/print-jobs", () => ({
  createPrintJob: api.createPrintJob,
  completePrintJob: api.completePrintJob,
}));

const token = "operator-token";
const idempotencyKey = "11111111-1111-4111-8111-111111111111";
const schedule: OperationSchedule = {
  date: "2026-10-30",
  time: "10:00",
  periodName: "오전",
  admissionName: "학생부교과 면접",
  buildingNames: ["본관"],
  candidateCount: 1,
  assignedCount: 1,
};
const candidate = {
  examineeNo: "1162001",
  examName: "2026년도 자격시험",
} as Examinee;
const assignment = {
  pseudonymNumber: "8201",
} as PseudonymAssignment;
const printer = { id: "GT800-USB", name: "GT800", connection: "USB" as const };
const diagnostic: PrinterDiagnostic = { status: "READY", printer, message: "출력 준비 완료" };

beforeEach(() => {
  api.createPrintJob.mockReset();
  api.completePrintJob.mockReset();
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(idempotencyKey);
});

describe("useOperationLabelPrint", () => {
  it("creates one job, sends every copy sequentially, then completes it as SENT", async () => {
    const events: string[] = [];
    const pendingSends: Array<() => void> = [];
    const job = printJob(3);
    api.createPrintJob.mockImplementation(async () => {
      events.push("create");
      return job;
    });
    api.completePrintJob.mockImplementation(async (_token: string, _id: string, status: string) => {
      events.push(`complete:${status}`);
      return { id: job.id, status };
    });
    const sendRaw = vi.fn(() => {
      const copy = sendRaw.mock.calls.length;
      events.push(`send:${copy}:start`);
      return new Promise<void>((resolve) => {
        pendingSends.push(() => {
          events.push(`send:${copy}:done`);
          resolve();
        });
      });
    });
    const onNotice = vi.fn();
    const { result } = renderLabelPrint(sendRaw, onNotice);

    let printRequest!: Promise<void>;
    act(() => {
      printRequest = result.current.print();
    });

    await waitFor(() => expect(sendRaw).toHaveBeenCalledTimes(1));
    expect(sendRaw).toHaveBeenNthCalledWith(1, printer, job.payload);
    expect(api.completePrintJob).not.toHaveBeenCalled();

    await resolveNextSend(pendingSends);
    await waitFor(() => expect(sendRaw).toHaveBeenCalledTimes(2));
    expect(api.completePrintJob).not.toHaveBeenCalled();

    await resolveNextSend(pendingSends);
    await waitFor(() => expect(sendRaw).toHaveBeenCalledTimes(3));
    expect(api.completePrintJob).not.toHaveBeenCalled();

    await act(async () => {
      pendingSends.shift()?.();
      await printRequest;
    });

    expect(events).toEqual([
      "create",
      "send:1:start",
      "send:1:done",
      "send:2:start",
      "send:2:done",
      "send:3:start",
      "send:3:done",
      "complete:SENT",
    ]);
    expect(api.createPrintJob).toHaveBeenCalledWith(
      token,
      candidate.examineeNo,
      1,
      {
        examName: candidate.examName,
        examDate: schedule.date,
        examTime: schedule.time,
        periodName: schedule.periodName,
        admissionName: schedule.admissionName,
      },
      idempotencyKey,
    );
    expect(api.completePrintJob).toHaveBeenCalledWith(token, job.id, "SENT");
    expect(onNotice).toHaveBeenCalledWith({
      kind: "success",
      text: "가번호 8201 라벨 3매를 프린터로 전송했습니다.",
    });
    expect(result.current.printing).toBe(false);
  });

  it("best-effort completes FAILED but preserves the original send error for the user", async () => {
    const events: string[] = [];
    const job = printJob(2);
    const transmissionError = new Error("프린터 전송 원본 오류");
    api.createPrintJob.mockImplementation(async () => {
      events.push("create");
      return job;
    });
    api.completePrintJob.mockImplementation(async (_token: string, _id: string, status: string) => {
      events.push(`complete:${status}`);
      throw new Error("FAILED 상태 기록 오류");
    });
    const sendRaw = vi.fn(async () => {
      events.push("send");
      throw transmissionError;
    });
    const onNotice = vi.fn((notice) => {
      events.push(`notice:${notice.text}`);
    });
    const { result } = renderLabelPrint(sendRaw, onNotice);

    await act(async () => result.current.print());

    expect(sendRaw).toHaveBeenCalledOnce();
    expect(api.completePrintJob).toHaveBeenCalledOnce();
    expect(api.completePrintJob).toHaveBeenCalledWith(token, job.id, "FAILED", transmissionError.message);
    expect(api.completePrintJob).not.toHaveBeenCalledWith(token, job.id, "SENT");
    expect(onNotice).toHaveBeenCalledWith({ kind: "error", text: transmissionError.message });
    expect(events).toEqual(["create", "send", "complete:FAILED", `notice:${transmissionError.message}`]);
    expect(result.current.printing).toBe(false);
  });

  it("ignores a duplicate print request while the first create call is still pending", async () => {
    const create = deferred<ReturnType<typeof printJob>>();
    const job = printJob(1);
    api.createPrintJob.mockReturnValue(create.promise);
    api.completePrintJob.mockResolvedValue({ id: job.id, status: "SENT" });
    const sendRaw = vi.fn().mockResolvedValue(undefined);
    const onNotice = vi.fn();
    const { result } = renderLabelPrint(sendRaw, onNotice);

    let first!: Promise<void>;
    let duplicate!: Promise<void>;
    act(() => {
      first = result.current.print();
      duplicate = result.current.print();
    });

    expect(api.createPrintJob).toHaveBeenCalledOnce();
    await act(async () => {
      create.resolve(job);
      await Promise.all([first, duplicate]);
    });

    expect(sendRaw).toHaveBeenCalledOnce();
    expect(api.completePrintJob).toHaveBeenCalledOnce();
    expect(onNotice).toHaveBeenCalledOnce();
  });
});

function renderLabelPrint(sendRaw: ReturnType<typeof vi.fn>, onNotice: ReturnType<typeof vi.fn>) {
  const service = { sendRaw } as unknown as PrinterService;
  return renderHook(() =>
    useOperationLabelPrint({
      token,
      userRole: "OPERATOR",
      schedule,
      scheduleKey: "schedule-a",
      candidate,
      assignment,
      service,
      diagnostic,
      isCurrentTarget: () => true,
      onNotice,
    }),
  );
}

async function resolveNextSend(pendingSends: Array<() => void>) {
  await act(async () => {
    pendingSends.shift()?.();
    await Promise.resolve();
  });
}

function printJob(copies: number) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    jobNo: "PJ-TEST-1",
    status: "READY" as const,
    copies,
    format: "ZPL" as const,
    payload: "^XA^FD8201^FS^XZ",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
