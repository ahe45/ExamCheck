import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { networkInterfaces } from "node:os";
import http from "node:http";
import net from "node:net";
import express from "express";
import compression from "compression";
import dotenv from "dotenv";
import { ensureProductionSecret } from "./production-env.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
dotenv.config({ path: join(root, ".env"), quiet: true });
ensureProductionSecret(join(root, ".env"), process.env);
const apiPort = Number(process.env.PORT || 3100);
const webPort = 5173;
if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535 || apiPort === webPort)
  throw new Error("API PORT 설정을 확인해 주세요.");
for (const port of [apiPort, webPort])
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () =>
      reject(new Error(`포트 ${port}를 사용 중인 서버가 있습니다. 실행 중인 ExamCheck를 먼저 종료해 주세요.`)),
    );
    probe.listen(port, "0.0.0.0", () => probe.close(resolve));
  });
const api = spawn(process.execPath, [join(root, "apps/api/dist/main.js")], {
  cwd: join(root, "apps/api"),
  env: { ...process.env, NODE_ENV: "production" },
  windowsHide: true,
  stdio: "inherit",
});
let stopping = false;
let web;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  web?.close();
  api.kill("SIGTERM");
  const force = setTimeout(() => {
    api.kill("SIGKILL");
    process.exit(code);
  }, 10000);
  force.unref();
  api.once("exit", () => process.exit(code));
  if (api.exitCode !== null) process.exit(code);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
api.once("error", (error) => {
  console.error(error.message);
  stop(1);
});
api.once("exit", (code) => {
  if (!stopping) stop(code || 1);
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/v1/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("API 서버가 시작되지 않았습니다. 위의 오류를 확인해 주세요.");
  const app = express();
  app.disable("x-powered-by");
  app.use("/api", (request, response) => {
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: apiPort,
        path: request.originalUrl,
        method: request.method,
        headers: { ...request.headers, host: `127.0.0.1:${apiPort}` },
      },
      (incoming) => {
        response.writeHead(incoming.statusCode || 502, incoming.headers);
        incoming.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent) response.status(502).json({ message: "서버에 연결하지 못했습니다." });
      else response.destroy();
    });
    request.on("aborted", () => upstream.destroy());
    response.on("close", () => upstream.destroy());
    request.pipe(upstream);
  });
  app.use(compression());
  app.use("/assets", express.static(resolve(root, "apps/web/dist/assets"), { immutable: true, maxAge: "1y" }));
  app.use(express.static(resolve(root, "apps/web/dist"), { maxAge: 0 }));
  app.use((request, response) => {
    if (request.method !== "GET") return response.sendStatus(404);
    response.setHeader("Cache-Control", "no-cache");
    response.sendFile(resolve(root, "apps/web/dist/index.html"));
  });
  web = app.listen(webPort, "0.0.0.0", () => {
    console.log(`ExamCheck: http://localhost:${webPort}`);
    for (const addresses of Object.values(networkInterfaces()))
      for (const address of addresses || [])
        if (address.family === "IPv4" && !address.internal)
          console.log(`다른 PC 접속: http://${address.address}:${webPort}`);
  });
  web.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
} catch (error) {
  console.error(error.message);
  stop(1);
}
