export function createWorkLimiter(concurrency: number, maximumQueue = 256) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(work: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      if (queue.length >= maximumQueue) throw new Error("서버가 작업을 처리 중입니다. 잠시 후 다시 시도해 주세요.");
      await new Promise<void>((resolve) => queue.push(resolve));
    } else active++;
    try {
      return await work();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}
