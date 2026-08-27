import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDatabasePattern = /^examcheck_e2e_[0-9a-f]{32}$/;
const databaseName = `examcheck_e2e_${randomUUID().replaceAll("-", "")}`;
const playwrightArguments = process.argv.slice(2);
const apiPort = await findAvailablePort();
let webPort = await findAvailablePort();
while (webPort === apiPort) webPort = await findAvailablePort();

assertTemporaryDatabaseName(databaseName);
dotenv.config({ path: resolve(projectRoot, ".env"), quiet: true });

const childEnvironment = {
  ...process.env,
  NODE_ENV: "test",
  DB_NAME: databaseName,
  E2E_DB_NAME: databaseName,
  E2E_API_PORT: String(apiPort),
  E2E_WEB_PORT: String(webPort),
  E2E_MANAGED_SERVERS: "1",
  JWT_SECRET: "examcheck-e2e-session-secret-at-least-thirty-two-characters",
  ADMIN_INITIAL_PASSWORD: "1234",
  USER_INITIAL_PASSWORD: "1234",
  DEVELOPER_INITIAL_PASSWORD: "1234",
  VITE_PRINTER_MODE: "mock",
};

if (playwrightArguments.includes("--list")) {
  process.exitCode = await runNode(resolve(projectRoot, "node_modules/@playwright/test/cli.js"), [
    "test",
    ...playwrightArguments,
  ]);
} else {
  let runError;
  let managedServers = [];
  try {
    await runNpm(["run", "db:setup", "-w", "@examcheck/api"]);
    await assertOwnedDatabase(databaseName);
    await runNode(resolve(projectRoot, "e2e/seed.mjs"));
    managedServers = await startManagedServers();
    const exitCode = await runNode(resolve(projectRoot, "node_modules/@playwright/test/cli.js"), [
      "test",
      ...playwrightArguments,
    ]);
    if (exitCode !== 0) runError = new Error(`Playwright exited with code ${exitCode}.`);
  } catch (error) {
    runError = error;
  }

  const cleanupErrors = [];
  try {
    await stopManagedServers(managedServers);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await dropOwnedDatabase(databaseName);
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (runError && cleanupErrors.length > 0) {
    throw new AggregateError([runError, ...cleanupErrors], "E2E run and cleanup both failed.");
  }
  if (runError) throw runError;
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, "E2E cleanup failed.");
}

async function startManagedServers() {
  const servers = [];
  try {
    const apiServer = spawnManagedServer(
      "API",
      resolve(projectRoot, "node_modules/tsx/dist/cli.mjs"),
      ["src/main.ts"],
      resolve(projectRoot, "apps/api"),
      { PORT: String(apiPort), FRONTEND_ORIGIN: `http://127.0.0.1:${webPort}` },
    );
    servers.push(apiServer);
    await waitForManagedServer(apiServer, `http://127.0.0.1:${apiPort}/api/v1/health`);

    const webServer = spawnManagedServer(
      "Web",
      resolve(projectRoot, "node_modules/vite/bin/vite.js"),
      ["--configLoader", "runner", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
      resolve(projectRoot, "apps/web"),
      { VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}/api/v1` },
    );
    servers.push(webServer);
    await waitForManagedServer(webServer, `http://127.0.0.1:${webPort}`);
    return servers;
  } catch (error) {
    try {
      await stopManagedServers(servers);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "E2E server startup and cleanup both failed.");
    }
    throw error;
  }
}

function spawnManagedServer(name, modulePath, arguments_, cwd, environment) {
  const child = spawn(process.execPath, [modulePath, ...arguments_], {
    cwd,
    env: { ...childEnvironment, ...environment },
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  let settle;
  const completion = new Promise((resolvePromise) => {
    settle = resolvePromise;
  });
  child.once("error", (error) => settle({ error }));
  child.once("exit", (code, signal) => settle({ code, signal }));
  return { name, child, completion };
}

async function waitForManagedServer(server, url) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null || server.child.signalCode !== null) {
      const result = await server.completion;
      throw new Error(`${server.name} server exited before ${url} became available (${formatProcessResult(result)}).`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The server may still be binding its isolated port.
    }
    await delay(100);
  }
  throw new Error(`${server.name} server did not become available at ${url}.`);
}

async function stopManagedServers(servers) {
  const errors = [];
  for (const server of [...servers].reverse()) {
    try {
      await stopManagedServer(server);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Managed E2E servers did not stop cleanly.");
}

async function stopManagedServer(server) {
  if (server.child.exitCode !== null || server.child.signalCode !== null) return;
  server.child.kill("SIGTERM");
  if (await settlesWithin(server.completion, 3_000)) return;

  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const taskkillPath = resolve(systemRoot, "System32", "taskkill.exe");
    const exitCode = await runProcess(taskkillPath, ["/PID", String(server.child.pid), "/T", "/F"]);
    if (exitCode !== 0 && server.child.exitCode === null && server.child.signalCode === null) {
      throw new Error(`Could not stop ${server.name} server process ${server.child.pid}.`);
    }
  } else {
    server.child.kill("SIGKILL");
  }

  if (!(await settlesWithin(server.completion, 5_000))) {
    throw new Error(`${server.name} server process ${server.child.pid} did not exit.`);
  }
}

async function settlesWithin(promise, timeout) {
  return Promise.race([promise.then(() => true), delay(timeout).then(() => false)]);
}

function formatProcessResult(result) {
  if (result.error) return result.error.message;
  if (result.signal) return `signal ${result.signal}`;
  return `exit code ${result.code ?? 1}`;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function runNpm(arguments_) {
  const npmCli = childEnvironment.npm_execpath;
  if (!npmCli) throw new Error("The E2E runner must be started by npm so its CLI path is available.");
  return runNode(npmCli, arguments_).then((exitCode) => {
    if (exitCode !== 0) throw new Error(`npm ${arguments_.join(" ")} exited with code ${exitCode}.`);
    return exitCode;
  });
}

function runNode(modulePath, arguments_ = []) {
  return runProcess(process.execPath, [modulePath, ...arguments_]);
}

function runProcess(command, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd: projectRoot,
      env: childEnvironment,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} was terminated by ${signal}.`));
      else resolvePromise(code ?? 1);
    });
  });
}

function databaseConnectionConfig() {
  const port = Number(childEnvironment.DB_PORT || "3306");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DB_PORT must be a valid TCP port for E2E tests.");
  }
  return {
    host: childEnvironment.DB_HOST || "127.0.0.1",
    port,
    user: childEnvironment.DB_USER || "root",
    password: childEnvironment.DB_PASSWORD || "",
    charset: "utf8mb4",
    connectTimeout: 10_000,
  };
}

async function assertOwnedDatabase(expectedDatabaseName) {
  assertTemporaryDatabaseName(expectedDatabaseName);
  const connection = await mysql.createConnection({
    ...databaseConnectionConfig(),
    database: expectedDatabaseName,
  });
  try {
    const [databaseRows] = await connection.query("SELECT DATABASE() AS currentDatabase");
    if (databaseRows.length !== 1 || databaseRows[0]?.currentDatabase !== expectedDatabaseName) {
      throw new Error(`E2E connection does not own the expected database: ${expectedDatabaseName}.`);
    }
    const [migrationRows] = await connection.query(
      "SELECT COUNT(*) AS migrationCount FROM schema_migration WHERE version LIKE '025_%'",
    );
    if (Number(migrationRows[0]?.migrationCount) !== 1) {
      throw new Error(`E2E database is not at the expected migration baseline: ${expectedDatabaseName}.`);
    }
  } finally {
    await connection.end();
  }
}

async function dropOwnedDatabase(expectedDatabaseName) {
  assertTemporaryDatabaseName(expectedDatabaseName);
  const administrator = await mysql.createConnection(databaseConnectionConfig());
  try {
    const [beforeRows] = await administrator.execute(
      "SELECT SCHEMA_NAME AS schemaName FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?",
      [expectedDatabaseName],
    );
    if (beforeRows.length === 0) return;
    if (beforeRows.length !== 1 || beforeRows[0]?.schemaName !== expectedDatabaseName) {
      throw new Error(`Refusing ambiguous E2E database cleanup: ${expectedDatabaseName}.`);
    }

    await assertOwnedDatabase(expectedDatabaseName);
    await administrator.query(`DROP DATABASE \`${expectedDatabaseName}\``);

    const [afterRows] = await administrator.execute(
      "SELECT SCHEMA_NAME AS schemaName FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?",
      [expectedDatabaseName],
    );
    if (afterRows.length !== 0) throw new Error(`E2E database still exists after cleanup: ${expectedDatabaseName}.`);
  } finally {
    await administrator.end();
  }
}

function assertTemporaryDatabaseName(value) {
  if (!temporaryDatabasePattern.test(value)) throw new Error(`Unsafe E2E database name rejected: ${value}.`);
}

function findAvailablePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve an E2E TCP port."));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePromise(address.port);
      });
    });
  });
}
