export interface BoundedMapOptions {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?(completed: number, total: number): void;
}

export async function boundedMap<T, TResult>(
  values: readonly T[],
  mapper: (value: T, index: number, signal?: AbortSignal) => Promise<TResult>,
  options: BoundedMapOptions = {},
): Promise<TResult[]> {
  if (!values.length) return [];
  const concurrency = options.concurrency ?? 4;
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error("동시 작업 수는 1 이상의 정수여야 합니다.");
  }

  throwIfAborted(options.signal);
  const results = new Array<TResult>(values.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < values.length) {
      throwIfAborted(options.signal);
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index, options.signal);
      throwIfAborted(options.signal);
      completed += 1;
      options.onProgress?.(completed, values.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException("작업이 취소되었습니다.", "AbortError");
}

export function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException
    ? reason.name === "AbortError"
    : Boolean(reason && typeof reason === "object" && "name" in reason && reason.name === "AbortError");
}
