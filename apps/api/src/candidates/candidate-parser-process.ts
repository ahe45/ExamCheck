import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createWorkLimiter } from "../common/bounded-work.js";
const limited = createWorkLimiter(1, 8);
export function parseUploadInProcess(kind: "WORKBOOK" | "PHOTO_ARCHIVE", path: string, directory: string) {
  return limited(
    () =>
      new Promise<void>((resolve, reject) => {
        const compiled = fileURLToPath(new URL("./candidate-parser.worker.js", import.meta.url));
        const development = !existsSync(compiled);
        const worker = fork(development ? compiled.replace(/\.js$/, ".ts") : compiled, [], {
          execArgv: [...(development ? ["--import", "tsx"] : []), "--max-old-space-size=512"],
          ...{ windowsHide: true },
          serialization: "advanced",
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
        const timeout = setTimeout(() => {
          worker.kill();
          reject(new Error("파일 분석 시간이 초과되었습니다."));
        }, 5 * 60_000);
        let settled = false;
        worker.on("message", (result: { done?: boolean; error?: string }) => {
          if (!result.done && !result.error) return;
          settled = true;
          clearTimeout(timeout);
          if (result.error) reject(new Error(result.error));
          else resolve();
        });
        worker.on("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        worker.on("exit", () => {
          clearTimeout(timeout);
          if (!settled) reject(new Error("파일 분석 프로세스가 중단되었습니다."));
        });
        worker.send({ kind, path, directory });
      }),
  );
}
