// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationSchedule } from "../../shared/api/examinees";
import { useOperationRoster } from "./useOperationRoster";

const api = vi.hoisted(() => ({
  fetchOperationRoster: vi.fn(),
  fetchPseudonymOperationStatus: vi.fn(),
  closePseudonymOperation: vi.fn(),
  downloadPseudonymRosterExcel: vi.fn(),
}));

vi.mock("../../shared/api/examinees", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/api/examinees")>()),
  fetchOperationRoster: api.fetchOperationRoster,
}));

vi.mock("../../shared/api/pseudonyms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/api/pseudonyms")>()),
  fetchPseudonymOperationStatus: api.fetchPseudonymOperationStatus,
  closePseudonymOperation: api.closePseudonymOperation,
  downloadPseudonymRosterExcel: api.downloadPseudonymRosterExcel,
}));

const schedule: OperationSchedule = {
  date: "2026-10-30",
  time: "10:00",
  periodName: "오전",
  admissionName: "학생부교과 면접",
  buildingNames: ["본관"],
  candidateCount: 30,
  assignedCount: 0,
};

const openStatus = {
  closed: false,
  closedAt: null,
  closedByLoginId: null,
  autoAssignedAbsenteeCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchOperationRoster.mockResolvedValue([]);
  api.fetchPseudonymOperationStatus.mockResolvedValue(openStatus);
  api.downloadPseudonymRosterExcel.mockResolvedValue(undefined);
});

describe("useOperationRoster", () => {
  it("현재 교시의 명단과 마감 상태를 함께 불러온다", async () => {
    const onNotice = vi.fn();
    const { result } = renderHook(() =>
      useOperationRoster({
        token: "token",
        examName: "2026년도 자격시험",
        schedule,
        scheduleKey: "schedule-a",
        onNotice,
      }),
    );

    await waitFor(() => expect(result.current.statusLoaded).toBe(true));
    expect(result.current.rows).toEqual([]);
    expect(api.fetchOperationRoster).toHaveBeenCalledWith("token", schedule);
    expect(onNotice).toHaveBeenCalledWith(null);
  });

  it("마감 성공 후 명단을 다시 불러오고 완료 알림을 전달한다", async () => {
    const closedStatus = {
      closed: true,
      closedAt: "2026-08-28T12:00:00",
      closedByLoginId: "operator",
      autoAssignedAbsenteeCount: 2,
    };
    api.closePseudonymOperation.mockResolvedValue(closedStatus);
    const onNotice = vi.fn();
    const onClosed = vi.fn();
    const { result } = renderHook(() =>
      useOperationRoster({
        token: "token",
        examName: "2026년도 자격시험",
        schedule,
        scheduleKey: "schedule-a",
        onNotice,
      }),
    );
    await waitFor(() => expect(result.current.statusLoaded).toBe(true));

    await act(async () => result.current.finish(onClosed));

    expect(result.current.status).toEqual(closedStatus);
    expect(onClosed).toHaveBeenCalledOnce();
    expect(api.fetchOperationRoster).toHaveBeenCalledTimes(2);
    expect(onNotice).toHaveBeenLastCalledWith({
      kind: "success",
      text: "가번호 등록을 마감하고 결시자 2명의 가번호를 자동 부여했습니다.",
    });
  });

  it("엑셀 다운로드에는 화면 행이 아닌 허용된 필터·정렬 조건만 전달한다", async () => {
    const onNotice = vi.fn();
    const { result } = renderHook(() =>
      useOperationRoster({
        token: "token",
        examName: "2026년도 자격시험",
        schedule,
        scheduleKey: "schedule-a",
        onNotice,
      }),
    );
    await waitFor(() => expect(result.current.statusLoaded).toBe(true));
    const query = {
      filters: [{ field: "status" as const, mode: "include" as const, values: ["등록"] }],
      sort: { field: "examineeNo" as const, direction: "desc" as const },
    };

    await act(async () => result.current.download(query));

    expect(api.downloadPseudonymRosterExcel).toHaveBeenCalledWith(
      "token",
      {
        examName: "2026년도 자격시험",
        examDate: schedule.date,
        examTime: schedule.time,
        periodName: schedule.periodName,
        admissionName: schedule.admissionName,
        query,
      },
      "학생부교과 면접_2026-10-30_오전_가번호 등록 현황.xlsx",
    );
    expect(api.downloadPseudonymRosterExcel.mock.calls[0]?.[1]).not.toHaveProperty("rows");
  });
});
