import { randomUUID } from "node:crypto";
import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountsApplicationService } from "../src/accounts/accounts.application.js";
import { AccountsRepository } from "../src/accounts/accounts.repository.js";
import { AuthAuditService } from "../src/auth/auth-audit.service.js";
import { AuthGuard } from "../src/auth/auth.guard.js";
import { AuthService } from "../src/auth/auth.service.js";
import type { AuthenticatedUser, UserRole } from "../src/auth/auth.types.js";
import { LoginAttemptLimiter } from "../src/auth/login-attempt-limiter.js";
import { hashPassword } from "../src/auth/password.js";
import { MutationAuditRepository } from "../src/common/audit/mutation-audit.repository.js";
import { resolveAppConfig } from "../src/config/app-config.js";
import { DeveloperSettingsService } from "../src/developer-settings/developer-settings.service.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

const TEST_SECRET = "mariadb-session-version-integration-secret";
const TEST_PASSWORD = "initial-password";
const NEW_PASSWORD = "changed-password";

let harness: MariaDbIntegrationHarness;
let actor: AuthenticatedUser;
let accounts: AccountsApplicationService;
let auth: AuthService;
let guard: AuthGuard;

beforeAll(async () => {
  harness = await createMariaDbIntegrationHarness();
  const config = resolveAppConfig({
    NODE_ENV: "test",
    JWT_SECRET: TEST_SECRET,
    JWT_SESSION_TTL_SECONDS: "3600",
    JWT_ISSUER: "examcheck-integration-api",
    JWT_AUDIENCE: "examcheck-integration-web",
    JWT_CLOCK_TOLERANCE_SECONDS: "5",
  });
  auth = new AuthService(
    harness.pool,
    config,
    new LoginAttemptLimiter({ maxFailures: 100, failureWindowMs: 300_000, blockDurationMs: 60_000 }),
    new AuthAuditService(harness.pool),
  );
  guard = new AuthGuard(config, auth);
  accounts = new AccountsApplicationService(harness.pool, new AccountsRepository(), new MutationAuditRepository());
  actor = await readSystemActor(harness.pool);
});

afterAll(async () => {
  if (harness) await harness.cleanup();
});

describe("session version MariaDB integration", () => {
  it("applies a non-null safe default for existing and new users", async () => {
    const [columns] = await harness.pool.execute<
      Array<RowDataPacket & { nullable: string; columnDefault: string; columnType: string }>
    >(
      `SELECT IS_NULLABLE AS nullable, COLUMN_DEFAULT AS columnDefault, COLUMN_TYPE AS columnType
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'session_version'`,
    );
    expect(columns).toHaveLength(1);
    expect(columns[0]).toMatchObject({ nullable: "NO", columnDefault: "1" });
    expect(columns[0]?.columnType).toContain("bigint");
    expect(columns[0]?.columnType).toContain("unsigned");

    const [existing] = await harness.pool.execute<Array<RowDataPacket & { sessionVersion: number }>>(
      "SELECT session_version AS sessionVersion FROM app_user WHERE id = ?",
      [actor.id],
    );
    expect(Number(existing[0]?.sessionVersion)).toBe(1);
  });

  it("rejects an old token after an atomic password change and accepts a fresh login", async () => {
    const account = await createOperator("password");
    const oldToken = await loginToken(account.loginId, TEST_PASSWORD);
    await expectTokenAccepted(oldToken);

    await accounts.update(
      account.id,
      {
        loginId: account.loginId,
        role: "USER",
        password: NEW_PASSWORD,
        admissionNames: [],
      },
      actor,
    );

    await expectTokenRejected(oldToken);
    await expect(auth.login(account.loginId, TEST_PASSWORD, "password-old")).rejects.toThrow(UnauthorizedException);
    const freshToken = await loginToken(account.loginId, NEW_PASSWORD);
    await expectTokenAccepted(freshToken);
    await expectSessionState(account.id, 2, true, "OPERATOR");
  });

  it("rejects an old token after a role change", async () => {
    const account = await createOperator("role");
    const oldToken = await loginToken(account.loginId, TEST_PASSWORD);

    await accounts.update(account.id, { loginId: account.loginId, role: "ADMIN", admissionNames: [] }, actor);

    await expectTokenRejected(oldToken);
    const freshToken = await loginToken(account.loginId, TEST_PASSWORD);
    await expectTokenAccepted(freshToken);
    await expectSessionState(account.id, 2, true, "ADMIN");
  });

  it("rejects an old token after disabling an account", async () => {
    const account = await createOperator("disable");
    const oldToken = await loginToken(account.loginId, TEST_PASSWORD);

    await accounts.remove(account.id, actor);

    await expectTokenRejected(oldToken);
    await expectSessionState(account.id, 2, false, "OPERATOR");
  });

  it("rolls back password and session version together when the audit write fails", async () => {
    const account = await createOperator("rollback");
    const oldToken = await loginToken(account.loginId, TEST_PASSWORD);
    const failingAccounts = new AccountsApplicationService(harness.pool, new AccountsRepository(), {
      record: async () => {
        throw new Error("forced audit failure");
      },
    } as MutationAuditRepository);

    await expect(
      failingAccounts.update(
        account.id,
        {
          loginId: account.loginId,
          role: "USER",
          password: NEW_PASSWORD,
          admissionNames: [],
        },
        actor,
      ),
    ).rejects.toThrow("forced audit failure");

    await expectTokenAccepted(oldToken);
    await expectSessionState(account.id, 1, true, "OPERATOR");
    await expect(loginToken(account.loginId, TEST_PASSWORD)).resolves.toBeTypeOf("string");
  });

  it("invalidates the authenticated developer session when changing its password", async () => {
    const loginId = uniqueLoginId("developer");
    const [result] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO app_user (login_id, role, password_hash, enabled)
       VALUES (?, 'DEVELOPER', ?, TRUE)`,
      [loginId, await hashPassword(TEST_PASSWORD)],
    );
    const developer: AuthenticatedUser = {
      id: result.insertId,
      loginId,
      role: "DEVELOPER",
      admissionNames: [],
    };
    const oldToken = await loginToken(loginId, TEST_PASSWORD);
    const settings = new DeveloperSettingsService(harness.pool, new MutationAuditRepository());

    await settings.changePassword({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }, developer);

    await expectTokenRejected(oldToken);
    await expectTokenAccepted(await loginToken(loginId, NEW_PASSWORD));
    await expectSessionState(developer.id, 2, true, "DEVELOPER");
  });
});

async function createOperator(suffix: string) {
  return accounts.create(
    {
      loginId: uniqueLoginId(suffix),
      role: "USER",
      password: TEST_PASSWORD,
      admissionNames: [],
    },
    actor,
  );
}

async function loginToken(loginId: string, password: string): Promise<string> {
  return (await auth.login(loginId, password, `integration-${loginId}`)).token;
}

async function expectTokenAccepted(token: string): Promise<void> {
  await expect(guard.canActivate(executionContext(token))).resolves.toBe(true);
}

async function expectTokenRejected(token: string): Promise<void> {
  await expect(guard.canActivate(executionContext(token))).rejects.toThrow(UnauthorizedException);
}

function executionContext(token: string): ExecutionContext {
  const request = { headers: { authorization: `Bearer ${token}` } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

async function expectSessionState(
  userId: number,
  sessionVersion: number,
  enabled: boolean,
  role: UserRole,
): Promise<void> {
  const [rows] = await harness.pool.execute<
    Array<RowDataPacket & { sessionVersion: number; enabled: number; role: UserRole }>
  >(
    `SELECT session_version AS sessionVersion, enabled, role
     FROM app_user WHERE id = ?`,
    [userId],
  );
  expect(Number(rows[0]?.sessionVersion)).toBe(sessionVersion);
  expect(Boolean(rows[0]?.enabled)).toBe(enabled);
  expect(rows[0]?.role).toBe(role);
}

async function readSystemActor(pool: Pool): Promise<AuthenticatedUser> {
  const [rows] = await pool.execute<Array<RowDataPacket & { id: number; loginId: string; role: UserRole }>>(
    "SELECT id, login_id AS loginId, role FROM app_user WHERE login_id = 'system' LIMIT 1",
  );
  const row = rows[0];
  if (!row) throw new Error("Integration system actor is missing.");
  return { id: row.id, loginId: row.loginId, role: row.role, admissionNames: [] };
}

function uniqueLoginId(suffix: string): string {
  return `session-${suffix}-${randomUUID().slice(0, 8)}`;
}
