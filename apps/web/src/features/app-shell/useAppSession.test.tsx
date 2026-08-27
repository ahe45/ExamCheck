// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../shared/api/auth";
import type { OperationSchedule } from "../../shared/api/examinees";
import {
  OPERATION_SCHEDULE_KEY,
  SESSION_KEY,
  writeStoredOperationSchedule,
  writeStoredSession,
} from "../../shared/session/app-session";
import { useAppSession } from "./useAppSession";

const mocks = vi.hoisted(() => ({
  fetchCurrentUser: vi.fn(),
  fetchOperationSchedules: vi.fn(),
  unauthorizedListener: null as (() => void) | null,
}));

vi.mock("../../shared/api/auth", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("../../shared/api/auth")>();
  return { ...original, fetchCurrentUser: mocks.fetchCurrentUser };
});

vi.mock("../../shared/api/client", () => ({
  subscribeToUnauthorized: vi.fn((listener: () => void) => {
    mocks.unauthorizedListener = listener;
    return () => {
      if (mocks.unauthorizedListener === listener) mocks.unauthorizedListener = null;
    };
  }),
}));

vi.mock("../../shared/api/examinees", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("../../shared/api/examinees")>();
  return { ...original, fetchOperationSchedules: mocks.fetchOperationSchedules };
});

const operatorSession: Session = {
  token: "operator-token",
  user: { id: 7, loginId: "가번호", role: "OPERATOR", admissionNames: ["학생부교과"] },
};

const schedule: OperationSchedule = {
  date: "2026-10-30",
  time: "10:00",
  periodName: "오전",
  admissionName: "학생부교과",
  buildingNames: ["본관"],
  candidateCount: 30,
  assignedCount: 2,
};

describe("useAppSession", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.fetchCurrentUser.mockReset();
    mocks.fetchOperationSchedules.mockReset();
    mocks.unauthorizedListener = null;
  });

  it("검증된 저장 세션과 같은 사용자의 교시를 함께 복원한다", async () => {
    writeStoredSession(sessionStorage, operatorSession);
    writeStoredOperationSchedule(sessionStorage, operatorSession.user.id, schedule);
    mocks.fetchCurrentUser.mockResolvedValue(operatorSession.user);
    mocks.fetchOperationSchedules.mockResolvedValue([{ ...schedule, candidateCount: 31, assignedCount: 3 }]);
    const navigate = vi.fn();

    const { result } = renderHook(() =>
      useAppSession({
        pathname: "/operation",
        navigate,
        queryCache: { clear: vi.fn() },
        onAuthenticationCleared: vi.fn(),
      }),
    );

    await waitFor(() => expect(result.current.restoring).toBe(false));
    expect(result.current.session).toEqual(operatorSession);
    expect(result.current.operationSchedule).toEqual({ ...schedule, candidateCount: 31, assignedCount: 3 });
    expect(mocks.fetchCurrentUser).toHaveBeenCalledWith("operator-token");
    expect(mocks.fetchOperationSchedules).toHaveBeenCalledWith("operator-token");
    expect(JSON.parse(sessionStorage.getItem(OPERATION_SCHEDULE_KEY) || "null").schedule).toMatchObject({
      candidateCount: 31,
      assignedCount: 3,
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("저장 교시가 현재 허용 목록에서 사라지면 선택을 제거하고 교시 선택 화면으로 복귀한다", async () => {
    writeStoredSession(sessionStorage, operatorSession);
    writeStoredOperationSchedule(sessionStorage, operatorSession.user.id, schedule);
    mocks.fetchCurrentUser.mockResolvedValue(operatorSession.user);
    mocks.fetchOperationSchedules.mockResolvedValue([{ ...schedule, periodName: "오후", time: "14:00" }]);
    const navigate = vi.fn();

    const { result } = renderHook(() =>
      useAppSession({
        pathname: "/operation",
        navigate,
        queryCache: { clear: vi.fn() },
        onAuthenticationCleared: vi.fn(),
      }),
    );

    await waitFor(() => expect(result.current.restoring).toBe(false));
    expect(result.current.session).toEqual(operatorSession);
    expect(result.current.operationSchedule).toBeNull();
    expect(sessionStorage.getItem(OPERATION_SCHEDULE_KEY)).toBeNull();
    expect(navigate).toHaveBeenCalledWith("/operation/select", { replace: true });
  });

  it("허용 교시를 확인할 수 없는 경우 저장 선택을 신뢰하지 않고 안전한 선택 화면으로 복귀한다", async () => {
    writeStoredSession(sessionStorage, operatorSession);
    writeStoredOperationSchedule(sessionStorage, operatorSession.user.id, schedule);
    mocks.fetchCurrentUser.mockResolvedValue(operatorSession.user);
    mocks.fetchOperationSchedules.mockRejectedValue(new Error("schedule unavailable"));
    const navigate = vi.fn();

    const { result } = renderHook(() =>
      useAppSession({
        pathname: "/operation",
        navigate,
        queryCache: { clear: vi.fn() },
        onAuthenticationCleared: vi.fn(),
      }),
    );

    await waitFor(() => expect(result.current.restoring).toBe(false));
    expect(result.current.session).toEqual(operatorSession);
    expect(result.current.operationSchedule).toBeNull();
    expect(sessionStorage.getItem(OPERATION_SCHEDULE_KEY)).toBeNull();
    expect(navigate).toHaveBeenCalledWith("/operation/select", { replace: true });
  });

  it("로그인·교시 선택·교시 변경의 저장 상태와 경로를 한 경계에서 갱신한다", async () => {
    const navigate = vi.fn();
    const queryClear = vi.fn();
    const { result } = renderHook(() =>
      useAppSession({
        pathname: "/",
        navigate,
        queryCache: { clear: queryClear },
        onAuthenticationCleared: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.restoring).toBe(false));

    act(() => result.current.login(operatorSession));
    expect(JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null")).toEqual(operatorSession);
    expect(navigate).toHaveBeenLastCalledWith("/operation/select", { replace: true });
    expect(queryClear).not.toHaveBeenCalled();

    act(() => result.current.selectOperationSchedule(schedule));
    expect(JSON.parse(sessionStorage.getItem(OPERATION_SCHEDULE_KEY) || "null")).toEqual({
      userId: operatorSession.user.id,
      schedule,
    });
    expect(navigate).toHaveBeenLastCalledWith("/operation");

    act(() => result.current.clearOperationSchedule());
    expect(sessionStorage.getItem(OPERATION_SCHEDULE_KEY)).toBeNull();
    expect(result.current.operationSchedule).toBeNull();
    expect(navigate).toHaveBeenLastCalledWith("/operation/select");
  });

  it("인증된 요청의 401 알림에서 세션·교시·query cache와 런타임 상태를 함께 정리한다", async () => {
    const navigate = vi.fn();
    const queryClear = vi.fn();
    const onAuthenticationCleared = vi.fn();
    const { result } = renderHook(() =>
      useAppSession({ pathname: "/", navigate, queryCache: { clear: queryClear }, onAuthenticationCleared }),
    );
    await waitFor(() => expect(result.current.restoring).toBe(false));
    act(() => result.current.login(operatorSession));
    act(() => result.current.selectOperationSchedule(schedule));
    await waitFor(() => expect(mocks.unauthorizedListener).not.toBeNull());

    act(() => mocks.unauthorizedListener?.());

    expect(result.current.session).toBeNull();
    expect(result.current.operationSchedule).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(sessionStorage.getItem(OPERATION_SCHEDULE_KEY)).toBeNull();
    expect(onAuthenticationCleared).toHaveBeenCalledOnce();
    expect(queryClear).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenLastCalledWith("/", { replace: true });
  });
});
