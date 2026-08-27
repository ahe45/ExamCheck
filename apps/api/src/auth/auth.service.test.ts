import { HttpException, Logger, UnauthorizedException } from "@nestjs/common";
import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { resolveAppConfig } from "../config/app-config.js";
import type { AuthAuditService, AuthAuditRecord } from "./auth-audit.service.js";
import { AuthService } from "./auth.service.js";
import { LoginAttemptLimiter } from "./login-attempt-limiter.js";
import { hashPassword } from "./password.js";

const TEST_SECRET = "auth-service-unit-test-secret";
const VALID_PASSWORD = "correct-password";
const VALID_PASSWORD_HASH = await hashPassword(VALID_PASSWORD);

describe("AuthService login protection", () => {
  it("records a hashed failure without retaining an unknown login ID or IP", async () => {
    const pool = createPool(null);
    const audit = createAudit();
    const service = createService(pool, audit);

    await expect(service.login(" MissingUser ", "wrong-password", "203.0.113.10")).rejects.toThrow(
      UnauthorizedException,
    );

    const record = audit.records[0];
    expect(record).toMatchObject({
      eventType: "AUTH_LOGIN_FAILED",
      actorUserId: null,
      details: { reason: "INVALID_CREDENTIALS" },
    });
    expect(record?.details.loginIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record?.details.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(record)).not.toContain("missinguser");
    expect(JSON.stringify(record)).not.toContain("203.0.113.10");
  });

  it("returns 429 at the threshold and skips the user lookup while blocked", async () => {
    const pool = createPool(null);
    const audit = createAudit();
    const limiter = new LoginAttemptLimiter(
      {
        maxFailures: 1,
        failureWindowMs: 300_000,
        blockDurationMs: 900_000,
      },
      () => 1_000,
    );
    const service = createService(pool, audit, limiter);

    const thresholdAttempt = service.login("unknown", "wrong-password", "203.0.113.11");
    await expect(thresholdAttempt).rejects.toBeInstanceOf(HttpException);
    await thresholdAttempt.catch((error: unknown) => {
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).message).toContain("잠시 후 다시 시도");
    });

    await expect(service.login("unknown", "wrong-password", "203.0.113.11")).rejects.toMatchObject({ status: 429 });

    expect(pool.execute).toHaveBeenCalledTimes(1);
    expect(audit.records.map((record) => record.eventType)).toEqual([
      "AUTH_LOGIN_FAILED",
      "AUTH_LOGIN_BLOCKED",
      "AUTH_LOGIN_BLOCKED",
    ]);
    expect(audit.records.at(-1)?.details.reason).toBe("RATE_LIMIT_ACTIVE");
  });

  it("resets failures and records the known actor after a successful login", async () => {
    const pool = createPool({
      id: 7,
      loginId: "admin",
      role: "ADMIN",
      passwordHash: VALID_PASSWORD_HASH,
      enabled: 1,
      sessionVersion: 1,
    });
    const audit = createAudit();
    const limiter = new LoginAttemptLimiter(
      {
        maxFailures: 2,
        failureWindowMs: 300_000,
        blockDurationMs: 900_000,
      },
      () => 1_000,
    );
    const service = createService(pool, audit, limiter);

    await expect(service.login("ADMIN", "wrong-password", "203.0.113.12")).rejects.toThrow(UnauthorizedException);
    const result = await service.login(" ＡＤＭＩＮ ", VALID_PASSWORD, "203.0.113.12");
    await expect(service.login("admin", "wrong-password", "203.0.113.12")).rejects.toThrow(UnauthorizedException);

    expect(result.user).toMatchObject({ id: 7, loginId: "admin", role: "ADMIN" });
    expect(result.token.split(".")).toHaveLength(3);
    expect(audit.records.find((record) => record.eventType === "AUTH_LOGIN_SUCCEEDED")).toMatchObject({
      actorUserId: 7,
      details: { reason: "AUTHENTICATED" },
    });
  });

  it("still returns a successful login if the isolated audit writer rejects", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const pool = createPool({
      id: 8,
      loginId: "admin",
      role: "ADMIN",
      passwordHash: VALID_PASSWORD_HASH,
      enabled: 1,
      sessionVersion: 1,
    });
    const authAudit = {
      record: vi.fn().mockRejectedValue(new Error("audit unavailable")),
    } as unknown as AuthAuditService;
    const service = new AuthService(pool as unknown as Pool, testConfig(), defaultLimiter(), authAudit);

    await expect(service.login("admin", VALID_PASSWORD, "203.0.113.13")).resolves.toMatchObject({ user: { id: 8 } });
  });
});

interface TestUser {
  id: number;
  loginId: string;
  role: "ADMIN" | "OPERATOR" | "DEVELOPER";
  passwordHash: string;
  enabled: number;
  sessionVersion: number;
}

function createPool(user: TestUser | null) {
  return {
    execute: vi.fn(async (sql: string) => {
      if (sql.includes("FROM app_user")) return [user ? [user] : [], []];
      if (sql.includes("FROM user_admission_assignment")) return [[], []];
      throw new Error(`Unexpected SQL in test: ${sql}`);
    }),
  };
}

function createAudit() {
  const records: AuthAuditRecord[] = [];
  return {
    records,
    service: {
      record: vi.fn(async (record: AuthAuditRecord) => {
        records.push(record);
        return true;
      }),
    } as unknown as AuthAuditService,
  };
}

function createService(
  pool: ReturnType<typeof createPool>,
  audit: ReturnType<typeof createAudit>,
  limiter = defaultLimiter(),
) {
  return new AuthService(pool as unknown as Pool, testConfig(), limiter, audit.service);
}

function defaultLimiter() {
  return new LoginAttemptLimiter(
    {
      maxFailures: 5,
      failureWindowMs: 300_000,
      blockDurationMs: 900_000,
    },
    () => 1_000,
  );
}

function testConfig() {
  return resolveAppConfig({ NODE_ENV: "test", JWT_SECRET: TEST_SECRET });
}
