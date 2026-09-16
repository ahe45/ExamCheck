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
  printedCount: 0,
  labelPrintingEnabled: false,
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
  it("출력일시가 있는 조회 결과는 자동 출력 요청을 보내지 않는다", async () => {
    const sendRaw = vi.fn();
    const onNotice = vi.fn();
    const { result } = renderLabelPrint(sendRaw, onNotice);
    await act(async () =>
      result.current.print({ candidate: { ...candidate, lastPrintedAt: "2026-09-09T00:00:00Z" }, assignment }),
    );
    expect(api.createPrintJob).not.toHaveBeenCalled();
    expect(sendRaw).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith({ kind: "error", text: "이미 출력된 수험생은 라벨을 재출력할 수 없습니다." });
  });

  it("출력 완료 직후에는 이전 조회 상태가 남아 있어도 수동·자동 재출력을 막는다", async () => {
    api.createPrintJob.mockResolvedValue(printJob(1));
    api.completePrintJob.mockResolvedValue({ status: "SENT" });
    const sendRaw = vi.fn().mockResolvedValue(undefined);
    const { result } = renderLabelPrint(sendRaw, vi.fn());
    await act(async () => result.current.print());
    expect(result.current.alreadyPrinted).toBe(true);
    act(() => result.current.reset());
    await act(async () => result.current.print());
    await act(async () => result.current.print({ candidate, assignment }));
    expect(api.createPrintJob).toHaveBeenCalledTimes(1);
    expect(sendRaw).toHaveBeenCalledTimes(1);
  });

  it("서버가 이미 처리된 작업을 반환해도 프린터로 재전송하지 않는다", async () => {
    api.createPrintJob.mockResolvedValue({ ...printJob(1), status: "SENT" });
    const sendRaw = vi.fn();
    const { result } = renderLabelPrint(sendRaw, vi.fn());
    await act(async () => result.current.print());
    expect(sendRaw).not.toHaveBeenCalled();
    expect(api.completePrintJob).not.toHaveBeenCalled();
  });

  it("조회 직후에는 이전 선택 대신 전달받은 수험생을 지정 매수로 출력한다", async () => {
    api.createPrintJob.mockResolvedValue(printJob(1));
    const sendRaw = vi.fn().mockResolvedValue(undefined);
    const onNotice = vi.fn();
    const { result } = renderLabelPrint(sendRaw, onNotice);
    await act(async () =>
      result.current.print({
        candidate: { ...candidate, examineeNo: "NEXT-002" },
        assignment: { ...assignment, pseudonymNumber: "8202" },
      }),
    );
    expect(api.createPrintJob.mock.calls[0]?.[1]).toBe("NEXT-002");
    expect(onNotice).toHaveBeenCalledWith({ kind: "success", text: "가번호 8202 라벨 1매를 프린터로 전송했습니다." });
  });

  it("양식 기본값을 적용하고 사용자 수정값을 전송하며 일정·양식 변경 시 초기화한다", async () => {
    api.createPrintJob.mockImplementation(async (_token, _examineeNo, copies) => printJob(copies));
    const sendRaw = vi.fn().mockResolvedValue(undefined);
    const defaults = { templateId: 7, templateName: "접수 라벨", copies: 2 };
    const { result, rerender } = renderHook(
      ({ labelPrintDefaults, scheduleKey, selectedCandidate }) =>
        useOperationLabelPrint({
          token,
          userRole: "OPERATOR",
          schedule,
          scheduleKey,
          candidate: selectedCandidate,
          assignment,
          service: { sendRaw } as unknown as PrinterService,
          diagnostic,
          labelPrintDefaults,
          isCurrentTarget: () => true,
          onNotice: vi.fn(),
        }),
      { initialProps: { labelPrintDefaults: defaults, scheduleKey: "a", selectedCandidate: candidate } },
    );
    expect(result.current.copies).toBe(2);
    act(() => result.current.setCopies(3));
    await act(async () => result.current.print());
    expect(api.createPrintJob.mock.calls[0]?.[2]).toBe(3);
    expect(sendRaw).toHaveBeenCalledTimes(3);
    expect(defaults.copies).toBe(2);
    rerender({
      labelPrintDefaults: defaults,
      scheduleKey: "a",
      selectedCandidate: { ...candidate, examineeNo: "next" },
    });
    expect(result.current.copies).toBe(3);
    rerender({ labelPrintDefaults: defaults, scheduleKey: "b", selectedCandidate: candidate });
    expect(result.current.copies).toBe(2);
    rerender({ labelPrintDefaults: defaults, scheduleKey: "a", selectedCandidate: candidate });
    expect(result.current.copies).toBe(2);
    rerender({ labelPrintDefaults: defaults, scheduleKey: "b", selectedCandidate: candidate });
    act(() => result.current.setCopies(5));
    rerender({
      labelPrintDefaults: { ...defaults, templateId: 8, copies: 4 },
      scheduleKey: "b",
      selectedCandidate: candidate,
    });
    expect(result.current.copies).toBe(4);
  });

  it.each(["", 0, 11, 1.5] as const)("유효하지 않은 매수 %s로는 출력하지 않는다", async (value) => {
    const sendRaw = vi.fn();
    const { result } = renderLabelPrint(sendRaw, vi.fn());
    act(() => result.current.setCopies(value));
    expect(result.current.copiesValid).toBe(false);
    await act(async () => result.current.print());
    expect(api.createPrintJob).not.toHaveBeenCalled();
    expect(sendRaw).not.toHaveBeenCalled();
  });

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

it("allows a fresh print after an authorized history reset clears the local guard", async () => {
  api.createPrintJob.mockResolvedValue(printJob(1));
  api.completePrintJob.mockResolvedValue({ status: "SENT" });
  const sendRaw = vi.fn().mockResolvedValue(undefined);
  const { result } = renderLabelPrint(sendRaw, vi.fn());
  await act(async () => result.current.print());
  expect(result.current.alreadyPrinted).toBe(true);
  act(() => result.current.clearHistory());
  expect(result.current.alreadyPrinted).toBe(false);
  await act(async () => result.current.print());
  expect(sendRaw).toHaveBeenCalledTimes(2);
});

it("한 수험생의 출력이력을 삭제해도 다른 수험생의 재출력 제한은 유지한다", async () => {
  api.createPrintJob.mockResolvedValue(printJob(1));
  api.completePrintJob.mockResolvedValue({ status: "SENT" });
  const sendRaw = vi.fn().mockResolvedValue(undefined);
  const { result } = renderLabelPrint(sendRaw, vi.fn());
  const other = { ...candidate, id: candidate.id + 1, examineeNo: "OTHER-001" };
  await act(async () => result.current.print());
  await act(async () => result.current.print({ candidate: other, assignment }));
  act(() => result.current.clearCandidateHistory(candidate));
  expect(result.current.alreadyPrinted).toBe(false);
  await act(async () => result.current.print({ candidate: other, assignment }));
  expect(sendRaw).toHaveBeenCalledTimes(2);
  await act(async () => result.current.print());
  expect(sendRaw).toHaveBeenCalledTimes(3);
});
