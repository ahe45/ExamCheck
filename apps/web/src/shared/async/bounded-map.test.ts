import { describe, expect, it, vi } from "vitest";
import { boundedMap, isAbortError } from "./bounded-map";

describe("boundedMap", () => {
  it("limits concurrent tasks while preserving input order", async () => {
    let active = 0;
    let peak = 0;
    const progress = vi.fn();
    const result = await boundedMap(
      [4, 1, 3, 2],
      async (value) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, value));
        active -= 1;
        return value * 10;
      },
      { concurrency: 2, onProgress: progress },
    );

    expect(result).toEqual([40, 10, 30, 20]);
    expect(peak).toBe(2);
    expect(progress).toHaveBeenLastCalledWith(4, 4);
  });

  it("stops scheduling work after cancellation", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const pending = boundedMap(
      [1, 2, 3],
      async (value) => {
        started.push(value);
        controller.abort(new DOMException("사용자 취소", "AbortError"));
        return value;
      },
      { concurrency: 1, signal: controller.signal },
    );

    await expect(pending).rejects.toSatisfy(isAbortError);
    expect(started).toEqual([1]);
  });

  it("does not report progress when an abort-unaware mapper completes late", async () => {
    const controller = new AbortController();
    const progress = vi.fn();
    let finish: ((value: number) => void) | undefined;
    const pending = boundedMap(
      [1, 2],
      (_value, _index, signal) => {
        expect(signal).toBe(controller.signal);
        return new Promise<number>((resolve) => {
          finish = resolve;
        });
      },
      { concurrency: 1, signal: controller.signal, onProgress: progress },
    );
    controller.abort(new DOMException("사용자 취소", "AbortError"));
    finish?.(10);

    await expect(pending).rejects.toSatisfy(isAbortError);
    expect(progress).not.toHaveBeenCalled();
  });

  it("rejects an invalid concurrency before running tasks", async () => {
    const mapper = vi.fn(async (value: number) => value);
    await expect(boundedMap([1], mapper, { concurrency: 0 })).rejects.toThrow("동시 작업 수");
    expect(mapper).not.toHaveBeenCalled();
  });
});
