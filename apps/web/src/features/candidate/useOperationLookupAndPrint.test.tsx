// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Examinee } from "../../shared/api/examinees";
import type { PseudonymAssignment } from "../../shared/api/pseudonyms";
import { useOperationLookupAndPrint } from "./useOperationLookupAndPrint";

const selection = {
  candidate: { examineeNo: "002" } as Examinee,
  assignment: { pseudonymNumber: "02" } as PseudonymAssignment,
};
function options() {
  return {
    ready: true,
    printing: false,
    labelPrintingEnabled: true,
    lookup: vi.fn().mockResolvedValue(selection),
    isCurrent: vi.fn().mockReturnValue(true),
    print: vi.fn().mockResolvedValue(undefined),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("수험번호 제출 후 라벨 자동 출력", () => {
  it("조회부터 출력 완료까지 중복 엔터를 막고 다음 스캔은 처리한다", async () => {
    const config = options();
    const lookup = deferred<typeof selection>();
    const print = deferred<void>();
    config.lookup.mockReturnValueOnce(lookup.promise);
    config.print.mockReturnValueOnce(print.promise);
    const { result } = renderHook(() => useOperationLookupAndPrint(config));
    let request!: Promise<void>;
    act(() => {
      request = result.current.submit("002");
    });
    await act(async () => {
      await result.current.submit("002");
    });
    expect(config.lookup).toHaveBeenCalledTimes(1);
    expect(config.print).not.toHaveBeenCalled();
    await act(async () => {
      lookup.resolve(selection);
    });
    expect(config.print).toHaveBeenCalledWith(selection);
    expect(result.current.busy).toBe(true);
    await act(async () => {
      await result.current.submit("002");
    });
    expect(config.lookup).toHaveBeenCalledTimes(1);
    await act(async () => {
      print.resolve();
      await request;
    });
    expect(result.current.busy).toBe(false);
    await act(async () => {
      await result.current.submit("003");
    });
    expect(config.lookup).toHaveBeenLastCalledWith("003");
    expect(config.print).toHaveBeenCalledTimes(2);
  });

  it.each(["not-found", "no-number", "stale", "disabled", "absent"])("%s 결과는 출력하지 않는다", async (kind) => {
    const config = options();
    if (kind === "not-found") config.lookup.mockResolvedValue(undefined);
    if (kind === "no-number") config.lookup.mockResolvedValue({ ...selection, assignment: null });
    if (kind === "stale") config.isCurrent.mockReturnValue(false);
    if (kind === "disabled") config.labelPrintingEnabled = false;
    if (kind === "absent")
      config.lookup.mockResolvedValue({ ...selection, candidate: { ...selection.candidate, absent: true } });
    const { result } = renderHook(() => useOperationLookupAndPrint(config));
    await act(async () => {
      await result.current.submit("002");
    });
    expect(config.print).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });

  it("이미 인쇄 중이거나 설정을 읽는 동안에는 검색을 시작하지 않는다", async () => {
    const config = options();
    config.printing = true;
    const { result, rerender } = renderHook(() => useOperationLookupAndPrint(config));
    await act(async () => {
      await result.current.submit("002");
    });
    config.printing = false;
    config.ready = false;
    rerender();
    await act(async () => {
      await result.current.submit("002");
    });
    expect(config.lookup).not.toHaveBeenCalled();
  });
});
