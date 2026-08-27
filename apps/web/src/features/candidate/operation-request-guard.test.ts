import { describe, expect, it } from "vitest";
import {
  canRunScheduledAutoDraw,
  createOperationRequestTarget,
  isCurrentPhotoRequest,
  isCurrentScheduleRequest,
  operationScheduleKey,
} from "./operation-request-guard";

const schedule = { date: "2026-08-27", time: "10:00", periodName: "오전", admissionName: "학생부교과 면접" };

describe("operation async request guard", () => {
  it("교시 범위 전체를 안정적인 요청 키로 만든다", () => {
    expect(operationScheduleKey(schedule)).toBe("2026-08-27\u001f10:00\u001f오전\u001f학생부교과 면접");
  });

  it("사진 응답은 최신 요청 번호와 최신 수험생·교시가 모두 일치할 때만 허용한다", () => {
    const target = createOperationRequestTarget("1162001", schedule);
    const request = { requestId: 3, target };

    expect(isCurrentPhotoRequest(request, 3, target)).toBe(true);
    expect(isCurrentPhotoRequest(request, 4, target)).toBe(false);
    expect(isCurrentPhotoRequest(request, 3, createOperationRequestTarget("1162002", schedule))).toBe(false);
    expect(
      isCurrentPhotoRequest(request, 3, createOperationRequestTarget("1162001", { ...schedule, time: "13:00" })),
    ).toBe(false);
  });

  it("수험생 조회 응답은 요청 번호와 교시가 모두 최신일 때만 허용한다", () => {
    const request = { requestId: 7, scheduleKey: operationScheduleKey(schedule) };

    expect(isCurrentScheduleRequest(request, 7, operationScheduleKey(schedule))).toBe(true);
    expect(isCurrentScheduleRequest(request, 8, operationScheduleKey(schedule))).toBe(false);
    expect(isCurrentScheduleRequest(request, 7, operationScheduleKey({ ...schedule, periodName: "오후" }))).toBe(false);
  });

  it("자동 추첨은 예약 당시 수험생과 교시가 최신 상태이고 여전히 추첨 가능한 경우에만 실행한다", () => {
    const target = createOperationRequestTarget("1162001", schedule);
    const ready = {
      target,
      popoverOpen: true,
      mode: "RANDOM",
      operationClosed: false,
      assigned: false,
      assigning: false,
    };

    expect(canRunScheduledAutoDraw(target, ready)).toBe(true);
    expect(
      canRunScheduledAutoDraw(target, { ...ready, target: createOperationRequestTarget("1162002", schedule) }),
    ).toBe(false);
    expect(canRunScheduledAutoDraw(target, { ...ready, operationClosed: true })).toBe(false);
    expect(canRunScheduledAutoDraw(target, { ...ready, assigned: true })).toBe(false);
    expect(canRunScheduledAutoDraw(target, { ...ready, assigning: true })).toBe(false);
  });
});
