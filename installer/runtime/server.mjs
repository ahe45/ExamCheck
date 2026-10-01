import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, rename, rm, access, open } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import express from "express";
import compression from "compression";
import mysql from "mysql2/promise";
import AdmZip from "adm-zip";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}
const data = resolve(option("--data-dir", join(process.env.LOCALAPPDATA, "ExamCheck", "data")));
const paths = {
  settings: join(data, "settings.json"),
  status: join(data, "status.json"),
  command: join(data, "command.json"),
  client: join(data, "client.ini"),
  database: join(data, "database"),
  log: join(data, "logs", "server.log"),
  backups: join(data, "backups"),
};
const release = JSON.parse(await readFile(join(root, "release.json"), "utf8"));
let settings,
  db,
  api,
  web,
  shuttingDown = false;
let ready = false;
const sleep = (ms) => new Promise((accept) => setTimeout(accept, ms));
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function json(path, value) {
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, path);
}
async function status(state, message, extra = {}) {
  await json(paths.status, { state, message, pid: process.pid, ...extra });
}
await mkdir(join(data, "logs"), { recursive: true });
await mkdir(paths.backups, { recursive: true });
const lockPath = join(data, "server.lock");
if (await exists(lockPath)) {
  const previousPid = Number(await readFile(lockPath, "utf8"));
  let active = true;
  try {
    process.kill(previousPid, 0);
  } catch (error) {
    if (error.code === "ESRCH") active = false;
  }
  if (active) throw new Error("이 데이터 폴더를 사용하는 서버가 이미 실행 중입니다.");
  await rm(lockPath);
}
const lockFile = await open(lockPath, "wx");
await lockFile.writeFile(String(process.pid));
await lockFile.close();
const log = createWriteStream(paths.log, { flags: "a" });
function logMessage(message) {
  log.write(`${new Date().toISOString()} ${message}\n`);
}
function child(file, arguments_, options = {}) {
  const process_ = spawn(file, arguments_, {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  process_.stdout?.pipe(log, { end: false });
  process_.stderr?.pipe(log, { end: false });
  return process_;
}
async function run(file, arguments_, options = {}) {
  const process_ = child(file, arguments_, options);
  const [code] = await once(process_, "exit");
  if (code !== 0) throw new Error("작업이 실패했습니다. 로그 보기를 확인해 주세요.");
}
function maria(name) {
  return join(root, "runtime", "mariadb", "bin", `${name}.exe`);
}
function environment() {
  // Never inherit the development machine's database/auth settings.
  return {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(settings.apiPort),
    DB_HOST: "127.0.0.1",
    DB_PORT: String(settings.dbPort),
    DB_USER: "root",
    DB_PASSWORD: settings.dbPassword,
    DB_NAME: "examcheck",
    JWT_SECRET: settings.jwtSecret,
    IDENTITY_TRANSITION_ENABLED: "false",
    FRONTEND_ORIGIN: "",
    FRONTEND_ORIGINS: "",
    ADMIN_INITIAL_PASSWORD: settings.initialPassword || "",
    USER_INITIAL_PASSWORD: settings.initialPassword || "",
    DEVELOPER_INITIAL_PASSWORD: settings.initialPassword || "",
  };
}
async function connection() {
  return mysql.createConnection({
    host: "127.0.0.1",
    port: settings.dbPort,
    user: "root",
    password: settings.dbPassword,
  });
}
async function assertPortFree(port, host = "127.0.0.1") {
  await new Promise((accept, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error(`${port} 포트를 다른 프로그램이 사용 중입니다.`)));
    probe.listen(port, host, () => probe.close(accept));
  });
}
async function loadSettings() {
  if (await exists(paths.settings)) {
    settings = JSON.parse(await readFile(paths.settings, "utf8"));
    if (settings.mariadb !== release.mariadb)
      throw new Error("DB 엔진 버전이 다릅니다. 같은 MariaDB 버전의 패키지를 사용해 주세요.");
    return;
  }
  const firstRun = join(data, "first-run.json");
  const input = JSON.parse(await readFile(firstRun, "utf8"));
  if (
    typeof input.password !== "string" ||
    input.password.trim().length < 8 ||
    input.password.length > 200 ||
    input.password !== input.password.trim()
  )
    throw new Error("초기 비밀번호는 8자 이상이어야 합니다.");
  settings = {
    format: 1,
    mariadb: release.mariadb,
    webPort: 5173,
    apiPort: 3100,
    dbPort: 13316,
    lan: input.lan === true,
    dbPassword: randomBytes(36).toString("base64url"),
    jwtSecret: randomBytes(48).toString("base64url"),
    initialPassword: input.password,
    bootstrapped: false,
  };
  await json(paths.settings, settings);
  await rm(firstRun, { force: true });
}
async function startDatabase() {
  await assertPortFree(settings.dbPort);
  if (!(await exists(join(paths.database, "mysql")))) {
    await status("starting", "처음 사용할 데이터베이스를 준비하고 있습니다.");
    const temporary = join(data, "database.new");
    // Only discard our incomplete initialization, never the user's database.
    await rm(temporary, { recursive: true, force: true });
    await run(maria("mariadb-install-db"), [
      `--datadir=${temporary}`,
      `--password=${settings.dbPassword}`,
      `--port=${settings.dbPort}`,
    ]);
    await rename(temporary, paths.database);
  }
  const iniPath = join(data, "server.ini");
  const quoted = (path) => path.replaceAll("\\", "/");
  await writeFile(
    iniPath,
    `[mysqld]\nbasedir="${quoted(join(root, "runtime/mariadb"))}"\ndatadir="${quoted(paths.database)}"\nport=${settings.dbPort}\nbind-address=127.0.0.1\ncharacter-set-server=utf8mb4\ncollation-server=utf8mb4_unicode_ci\ninnodb-buffer-pool-size=128M\nmax-connections=40\n`,
    { mode: 0o600 },
  );
  await writeFile(
    paths.client,
    `[client]\nhost=127.0.0.1\nport=${settings.dbPort}\nuser=root\npassword=${settings.dbPassword}\nprotocol=tcp\n`,
    { mode: 0o600 },
  );
  db = child(maria("mariadbd"), [`--defaults-file=${iniPath}`, "--console"]);
  db.on("error", (error) => void failure(error));
  db.on("exit", () => {
    if (!shuttingDown) void failure(new Error("데이터베이스가 종료되었습니다. 로그를 확인해 주세요."));
  });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (shuttingDown) throw new Error("시작이 중단되었습니다.");
    try {
      const client = await connection();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error("데이터베이스 시작 시간이 초과되었습니다.");
}
async function migrate() {
  await status("starting", "프로그램 데이터를 준비하고 있습니다.");
  await run(
    process.execPath,
    [join(root, `apps/api/dist/database/${settings.bootstrapped ? "migrate" : "setup"}.js`)],
    {
      cwd: join(root, "apps/api"),
      env: environment(),
    },
  );
  settings.bootstrapped = true;
  delete settings.initialPassword;
  settings.lastRelease = release.releaseId;
  await json(paths.settings, settings);
}
async function backup() {
  await status("busy", "데이터를 백업하고 있습니다.");
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const sqlPath = join(paths.backups, `${stamp}.sql.partial`);
  const archivePath = join(paths.backups, `ExamCheck-${stamp}.ecbackup`);
  try {
    await run(maria("mariadb-dump"), [
      `--defaults-extra-file=${paths.client}`,
      "--single-transaction",
      "--quick",
      "--hex-blob",
      "--routines",
      "--triggers",
      `--result-file=${sqlPath}`,
      "examcheck",
    ]);
    const sql = await readFile(sqlPath);
    const archive = new AdmZip();
    archive.addFile("database.sql", sql);
    archive.addFile(
      "metadata.json",
      Buffer.from(
        JSON.stringify({
          format: 1,
          application: "ExamCheck",
          createdAt: stamp,
          version: release.version,
          mariadb: release.mariadb,
          sha256: createHash("sha256").update(sql).digest("hex"),
        }),
      ),
    );
    archive.writeZip(`${archivePath}.partial`);
    await rename(`${archivePath}.partial`, archivePath);
    logMessage(`Backup created: ${archivePath}`);
    return archivePath;
  } finally {
    await rm(sqlPath, { force: true });
  }
}
async function stopApplication() {
  ready = false;
  if (web) {
    const current = web;
    web = undefined;
    await new Promise((accept) => {
      current.close(accept);
      current.closeAllConnections();
    });
  }
  if (api && api.exitCode === null) {
    const current = api;
    api = undefined;
    const exited = once(current, "exit");
    if (current.connected) current.send("stop");
    const timeout = setTimeout(() => current.kill(), 15000);
    await exited;
    clearTimeout(timeout);
  }
}
async function restore(archivePath) {
  const archive = new AdmZip(archivePath);
  const metadata = JSON.parse(archive.readAsText("metadata.json"));
  const sql = archive.readFile("database.sql");
  if (
    metadata.format !== 1 ||
    metadata.application !== "ExamCheck" ||
    metadata.mariadb !== release.mariadb ||
    !sql ||
    createHash("sha256").update(sql).digest("hex") !== metadata.sha256
  ) {
    throw new Error("지원하지 않거나 손상된 백업 파일입니다.");
  }
  await stopApplication();
  const safetyBackup = await backup();
  await status("busy", "백업을 복원하고 있습니다. 창을 닫지 마세요.");
  const client = await connection();
  try {
    await client.query("DROP DATABASE IF EXISTS `examcheck`");
    await client.query("CREATE DATABASE `examcheck` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
  } finally {
    await client.end();
  }
  const importPath = join(data, "restore.sql");
  try {
    await writeFile(importPath, sql, { mode: 0o600 });
    const process_ = child(
      maria("mariadb"),
      [`--defaults-extra-file=${paths.client}`, "--binary-mode", "--database=examcheck"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const exited = once(process_, "exit");
    const input = createReadStream(importPath);
    input.on("error", (error) => {
      logMessage(error.message);
      process_.stdin.destroy(error);
    });
    process_.stdin.on("error", () => {});
    input.pipe(process_.stdin);
    const [code] = await exited;
    if (code !== 0) throw new Error(`복원에 실패했습니다. 복원 전 백업: ${safetyBackup}`);
    await migrate();
  } finally {
    await rm(importPath, { force: true });
  }
}
function addresses() {
  const urls = [`http://localhost:${settings.webPort}`];
  if (settings.lan)
    for (const list of Object.values(networkInterfaces()))
      for (const address of list || []) {
        if (address.family === "IPv4" && !address.internal) urls.push(`http://${address.address}:${settings.webPort}`);
      }
  return urls;
}
async function startApplication() {
  await assertPortFree(settings.apiPort);
  await assertPortFree(settings.webPort, settings.lan ? "0.0.0.0" : "127.0.0.1");
  await status("starting", "서버를 시작하고 있습니다.");
  api = child(process.execPath, [join(root, "runtime/api.mjs")], {
    env: environment(),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const current = api;
  current.on("error", (error) => void failure(error));
  current.on("exit", () => {
    if (api === current && !shuttingDown) void failure(new Error("API 서버가 종료되었습니다."));
  });
  let healthy = false;
  for (let attempt = 0; attempt < 120 && !shuttingDown; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${settings.apiPort}/api/v1/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {}
    await sleep(500);
  }
  if (!healthy) throw new Error("API 서버가 시작되지 않았습니다.");
  const app = express();
  app.disable("x-powered-by");
  app.use("/api", (request, response) => {
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: settings.apiPort,
        path: request.originalUrl,
        method: request.method,
        headers: { ...request.headers, host: `127.0.0.1:${settings.apiPort}` },
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
  app.use(express.static(join(root, "apps/web/dist")));
  app.use((request, response) => {
    if (request.method !== "GET") return response.sendStatus(404);
    response.setHeader("Cache-Control", "no-cache");
    response.sendFile(join(root, "apps/web/dist/index.html"));
  });
  web = app.listen(settings.webPort, settings.lan ? "0.0.0.0" : "127.0.0.1");
  await once(web, "listening");
  web.on("error", (error) => void failure(error));
  ready = true;
  await status("ready", "실행 중입니다.", { urls: addresses() });
}
async function shutdown(state = "stopped", message = "서버를 종료했습니다.") {
  if (shuttingDown) return;
  shuttingDown = true;
  await status("stopping", "서버를 안전하게 종료하고 있습니다.");
  await stopApplication();
  if (db && db.exitCode === null) {
    const current = db;
    const exited = once(current, "exit");
    try {
      // SQL shutdown flushes MariaDB cleanly; never taskkill the database.
      const client = await connection();
      try {
        await client.query("SHUTDOWN");
      } catch (error) {
        if (error.code !== "PROTOCOL_CONNECTION_LOST") throw error;
      } finally {
        await client.end().catch(() => {});
      }
      await exited;
    } catch (error) {
      logMessage(`Database shutdown failed: ${error.message}`);
      await status("error", "DB 종료를 확인하지 못했습니다. 로그를 확인하고 설치·업데이트를 중단해 주세요.");
      shuttingDown = false;
      return;
    }
  }
  await rm(paths.client, { force: true });
  await status(state, message);
  await rm(lockPath, { force: true });
  log.end();
}
async function failure(error) {
  if (shuttingDown) return;
  logMessage(error.stack || error.message);
  await shutdown("error", error.message);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
try {
  await status("starting", "실행 환경을 확인하고 있습니다.");
  await loadSettings();
  await startDatabase();
  if (settings.bootstrapped && settings.lastRelease !== release.releaseId) await backup();
  await migrate();
  const action = option("--action", "start");
  if (action === "backup") {
    const archive = await backup();
    await shutdown("stopped", `백업 완료: ${archive}`);
  } else {
    if (action === "restore") await restore(option("--archive"));
    await startApplication();
    let lastParentCheck = 0;
    while (!shuttingDown) {
      // A launcher crash must not leave an unattended server/database behind.
      if (option("--parent-pid") && Date.now() - lastParentCheck > 2000) {
        lastParentCheck = Date.now();
        try {
          process.kill(Number(option("--parent-pid")), 0);
        } catch {
          await shutdown();
          break;
        }
      }
      if (await exists(paths.command)) {
        const command = JSON.parse(await readFile(paths.command, "utf8"));
        await rm(paths.command, { force: true });
        if (command.action === "stop") {
          await shutdown();
          break;
        }
        if (command.action === "backup" && ready) {
          try {
            const archive = await backup();
            await status("ready", `백업 완료: ${archive}`, { urls: addresses() });
          } catch (error) {
            await status("ready", `백업 실패: ${error.message}`, { urls: addresses() });
          }
        }
      }
      await sleep(400);
    }
  }
} catch (error) {
  await failure(error);
}
