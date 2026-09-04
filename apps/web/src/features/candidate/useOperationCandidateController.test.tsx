// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Examinee, ExamineeLookupResult, OperationSchedule } from "../../shared/api/examinees";
import type { PseudonymAssignment } from "../../shared/api/pseudonyms";
import { useOperationCandidateController } from "./useOperationCandidateController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function examinee(examineeNo: string, name = "이예민"): Examinee {
  return {
    id: Number(examineeNo.slice(-2)) || 1,
    examineeNo,
    name,
    birthDate: "2008-03-12",
    examName: "2026년도 자격시험",
    examDate: "2026-10-30",
    roomName: "101호",
    seatNo: "1",
    labelBarcode: examineeNo,
    preassignedNumber: null,
    preassignedAvailable: false,
    assignedNumber: null,
    assignmentMode: null,
    assignedAt: null,
    status: "ACTIVE",
    examTime: "10:00",
    examEndTime: "11:00",
    periodName: "오전",
    periodCode: "1",
    admissionName: "학생부교과 면접",
    admissionCode: "A01",
    unitName: "유아교육과",
    unitCode: "U01",
    majorName: "유아교육",
    majorCode: "M01",
    buildingName: "본관",
    buildingCode: "B01",
    roomCode: "R01",
    groupName: "A조",
    opt1: "",
    opt2: "",
    opt3: "",
    absent: false,
  };
}

const schedule: OperationSchedule = {
  date: "2026-10-30",
  time: "10:00",
  periodName: "오전",
  admissionName: "학생부교과 면접",
  buildingNames: ["본관"],
  candidateCount: 30,
  assignedCount: 0,
};

const assignment: PseudonymAssignment = {
  id: 9,
  examineeNo: "1162001",
  examineeName: "이예민",
  examName: "2026년도 자격시험",
  pseudonymNumber: "1017",
  mode: "SEQUENTIAL",
  assignedAt: "2026-08-28T10:11:12",
  alreadyAssigned: false,
};

function options(overrides: Record<string, unknown> = {}) {
  return {
    token: "token",
    userRole: "OPERATOR",
    schedule,
    selectedMode: "SEQUENTIAL" as const,
    operationClosed: false,
    operationStatusLoaded: true,
    configuredRanges: [],
    useCandidatePhotos: false,
    range: { start: 1001, end: 1030 },
    autoDrawEnabled: false,
    autoDrawDelaySeconds: 3,
    onRangeChange: vi.fn(),
    onAssigned: vi.fn(),
    services: {
      lookupExaminee: vi.fn(async (examineeNo: string) => ({
        status: "CURRENT" as const,
        examinee: examinee(examineeNo),
      })),
      fetchPhoto: vi.fn(async () => null),
      assignPseudonym: vi.fn(async () => assignment),
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useOperationCandidateController", () => {
  it("빠르게 조회 대상을 바꿔도 취소된 이전 응답이 최신 수험생을 덮어쓰지 않는다", async () => {
    const first = deferred<ExamineeLookupResult>();
    const second = deferred<ExamineeLookupResult>();
    let firstSignal: AbortSignal | undefined;
    const lookupExaminee = vi
      .fn()
      .mockImplementationOnce((_no, _token, _schedule, signal: AbortSignal) => {
        firstSignal = signal;
        return first.promise;
      })
      .mockImplementationOnce(() => second.promise);
    const { result } = renderHook(() =>
      useOperationCandidateController(options({ services: { ...options().services, lookupExaminee } })),
    );

    act(() => void result.current.lookupExaminee("1162001"));
    act(() => result.current.resetLookup());
    expect(firstSignal?.aborted).toBe(true);
    act(() => void result.current.lookupExaminee("1162002"));

    await act(async () => {
      second.resolve({ status: "CURRENT", examinee: examinee("1162002", "최신") });
      await second.promise;
    });
    expect(result.current.candidate?.examineeNo).toBe("1162002");

    await act(async () => {
      first.resolve({ status: "CURRENT", examinee: examinee("1162001", "이전") });
      await first.promise;
    });
    expect(result.current.candidate).toMatchObject({ examineeNo: "1162002", name: "최신" });
  });

  it("교시가 바뀌면 진행 중 조회를 취소하고 후보자 상태를 초기화한다", async () => {
    const pending = deferred<ExamineeLookupResult>();
    let signal: AbortSignal | undefined;
    const lookupExaminee = vi.fn((_no, _token, _schedule, requestSignal: AbortSignal) => {
      signal = requestSignal;
      return pending.promise;
    });
    const firstOptions = options({ services: { ...options().services, lookupExaminee } });
    const { result, rerender } = renderHook(({ currentOptions }) => useOperationCandidateController(currentOptions), {
      initialProps: { currentOptions: firstOptions },
    });
    act(() => {
      result.current.setInput("1162001");
      void result.current.lookupExaminee("1162001");
    });

    rerender({
      currentOptions: {
        ...firstOptions,
        schedule: { ...schedule, time: "14:00", periodName: "오후" },
      },
    });

    expect(signal?.aborted).toBe(true);
    expect(result.current).toMatchObject({ input: "", candidate: null, searching: false, assignment: null });
  });

  it("추첨 화면이 닫히면 예약된 자동 추첨을 실행하지 않는다", async () => {
    vi.useFakeTimers();
    const assignPseudonym = vi.fn(async () => assignment);
    const currentOptions = options({
      selectedMode: "RANDOM",
      autoDrawEnabled: true,
      services: { ...options().services, assignPseudonym },
    });
    const { result } = renderHook(() => useOperationCandidateController(currentOptions));

    await act(async () => result.current.lookupExaminee("1162001"));
    expect(result.current.drawPopoverOpen).toBe(true);
    act(() => result.current.setDrawPopoverOpen(false));
    act(() => vi.advanceTimersByTime(4000));

    expect(assignPseudonym).not.toHaveBeenCalled();
    expect(result.current.autoDrawRemainingMs).toBe(0);
  });

  it("자동 추첨이 실패해도 같은 수험생에게 자동 재시도하지 않는다", async () => {
    vi.useFakeTimers();
    const assignPseudonym = vi.fn(async () => {
      throw new Error("일시 오류");
    });
    const currentOptions = options({
      selectedMode: "RANDOM",
      autoDrawEnabled: true,
      autoDrawDelaySeconds: 1,
      services: { ...options().services, assignPseudonym },
    });
    const { result } = renderHook(() => useOperationCandidateController(currentOptions));

    await act(async () => result.current.lookupExaminee("1162001"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(assignPseudonym).toHaveBeenCalledTimes(1);
    expect(result.current.notice).toEqual({ kind: "error", text: "일시 오류" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(assignPseudonym).toHaveBeenCalledTimes(1);
  });

  it("자동 추첨 카운트다운을 갱신하고 교시 전환 시 예약된 추첨을 취소한다", async () => {
    vi.useFakeTimers();
    const assignPseudonym = vi.fn(async () => assignment);
    const firstOptions = options({
      selectedMode: "RANDOM",
      autoDrawEnabled: true,
      autoDrawDelaySeconds: 2,
      services: { ...options().services, assignPseudonym },
    });
    const { result, rerender } = renderHook(({ currentOptions }) => useOperationCandidateController(currentOptions), {
      initialProps: { currentOptions: firstOptions },
    });

    await act(async () => result.current.lookupExaminee("1162001"));
    expect(result.current.autoDrawRemainingMs).toBe(2000);

    act(() => vi.advanceTimersByTime(600));
    expect(result.current.autoDrawRemainingMs).toBe(1400);

    rerender({
      currentOptions: {
        ...firstOptions,
        schedule: { ...schedule, time: "14:00", periodName: "오후" },
      },
    });
    expect(result.current.autoDrawRemainingMs).toBe(0);
    expect(result.current.candidate).toBeNull();

    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(assignPseudonym).not.toHaveBeenCalled();
  });

  it("가번호 부여 성공과 실패를 명시적인 상태로 반영한다", async () => {
    const assignPseudonym = vi.fn().mockResolvedValueOnce(assignment).mockRejectedValueOnce(new Error("범위 소진"));
    const currentOptions = options({ services: { ...options().services, assignPseudonym } });
    const { result } = renderHook(() => useOperationCandidateController(currentOptions));

    await act(async () => result.current.lookupExaminee("1162001"));
    await act(async () => result.current.assign());
    expect(result.current.assignment).toMatchObject({ pseudonymNumber: "1017" });
    expect(result.current.notice).toEqual({ kind: "success", text: "가번호가 정상적으로 부여되었습니다." });
    expect(assignPseudonym).toHaveBeenNthCalledWith(
      1,
      "token",
      "1162001",
      "SEQUENTIAL",
      {
        examName: "2026년도 자격시험",
        examDate: schedule.date,
        examTime: schedule.time,
        periodName: schedule.periodName,
        admissionName: schedule.admissionName,
      },
      undefined,
    );

    act(() => result.current.resetLookup());
    await act(async () => result.current.lookupExaminee("1162002"));
    await act(async () => result.current.assign());
    expect(result.current.assignment).toBeNull();
    expect(result.current.notice).toEqual({ kind: "error", text: "범위 소진" });
    expect(result.current.assigning).toBe(false);
  });

  it("사전 가번호는 조회 즉시 기존 배정으로 표시하고 별도 배정 요청을 보내지 않는다", async () => {
    const candidate = examinee("1162001");
    candidate.preassignedNumber = "0821";
    candidate.preassignedAvailable = true;
    const lookupExaminee = vi.fn(async () => ({ status: "CURRENT" as const, examinee: candidate }));
    const assignPseudonym = vi.fn(async () => assignment);
    const currentOptions = options({
      selectedMode: "PREASSIGNED",
      services: { ...options().services, lookupExaminee, assignPseudonym },
    });
    const { result } = renderHook(() => useOperationCandidateController(currentOptions));

    await act(async () => result.current.lookupExaminee("1162001"));

    expect(result.current.assignment).toMatchObject({ pseudonymNumber: "0821", mode: "PREASSIGNED" });
    expect(result.current.notice).toEqual({ kind: "success", text: "이미 부여된 가번호 0821을 확인했습니다." });
    expect(assignPseudonym).not.toHaveBeenCalled();
  });

  it("언마운트할 때 진행 중인 사진 요청을 중단한다", async () => {
    const pendingPhoto = deferred<Blob | null>();
    let photoSignal: AbortSignal | undefined;
    const fetchPhoto = vi.fn((_no, _token, _schedule, signal?: AbortSignal) => {
      photoSignal = signal;
      return pendingPhoto.promise;
    });
    const currentOptions = options({
      useCandidatePhotos: true,
      services: { ...options().services, fetchPhoto },
    });
    const { result, unmount } = renderHook(() => useOperationCandidateController(currentOptions));

    await act(async () => result.current.lookupExaminee("1162001"));
    expect(photoSignal?.aborted).toBe(false);
    unmount();
    expect(photoSignal?.aborted).toBe(true);
  });

  it("이전 수험생의 늦은 사진 응답이 최신 사진을 덮어쓰지 않는다", async () => {
    const firstPhoto = deferred<Blob | null>();
    const secondPhoto = deferred<Blob | null>();
    const firstBlob = new Blob(["first"], { type: "image/png" });
    const secondBlob = new Blob(["second"], { type: "image/png" });
    const fetchPhoto = vi.fn().mockReturnValueOnce(firstPhoto.promise).mockReturnValueOnce(secondPhoto.promise);
    const createObjectURL = vi.fn((blob: Blob) => (blob === secondBlob ? "blob:second" : "blob:first"));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const currentOptions = options({
      useCandidatePhotos: true,
      services: { ...options().services, fetchPhoto },
    });
    const { result } = renderHook(() => useOperationCandidateController(currentOptions));

    await act(async () => result.current.lookupExaminee("1162001"));
    await act(async () => result.current.lookupExaminee("1162002"));
    await act(async () => {
      secondPhoto.resolve(secondBlob);
      await secondPhoto.promise;
    });
    expect(result.current.photoUrl).toBe("blob:second");

    await act(async () => {
      firstPhoto.resolve(firstBlob);
      await firstPhoto.promise;
    });
    expect(result.current.photoUrl).toBe("blob:second");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("교시 전환으로 사진 상태를 비울 때 생성한 object URL을 해제한다", async () => {
    const photo = new Blob(["photo"], { type: "image/png" });
    const fetchPhoto = vi.fn(async () => photo);
    const createObjectURL = vi.fn(() => "blob:current");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const firstOptions = options({
      useCandidatePhotos: true,
      services: { ...options().services, fetchPhoto },
    });
    const { result, rerender } = renderHook(({ currentOptions }) => useOperationCandidateController(currentOptions), {
      initialProps: { currentOptions: firstOptions },
    });

    await act(async () => {
      await result.current.lookupExaminee("1162001");
      await Promise.resolve();
    });
    expect(result.current.photoUrl).toBe("blob:current");

    rerender({
      currentOptions: {
        ...firstOptions,
        schedule: { ...schedule, time: "14:00", periodName: "오후" },
      },
    });

    expect(result.current.photoUrl).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:current");
  });
});
