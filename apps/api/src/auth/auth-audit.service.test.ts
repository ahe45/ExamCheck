import { Logger } from "@nestjs/common";
import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { runWithRequestContext } from "../common/http/request-context.js";
import { AuthAuditService, type AuthAuditRecord } from "./auth-audit.service.js";

describe("AuthAuditService", () => {
  it("stores only the approved hashed details", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]);
    const service = new AuthAuditService({ execute } as unknown as Pool);
    const details = {
      loginIdHash: "A".repeat(64),
      ipHash: "B".repeat(64),
      reason: "AUTHENTICATED" as const,
    };

    await expect(
      service.record({
        eventType: "AUTH_LOGIN_SUCCEEDED",
        actorUserId: 1,
        details,
      }),
    ).resolves.toBe(true);

    expect(execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), [
      "AUTH_LOGIN_SUCCEEDED",
      1,
      null,
      JSON.stringify({ loginIdHash: "a".repeat(64), ipHash: "b".repeat(64), reason: "AUTHENTICATED" }),
    ]);
  });

  it("links a login audit to the active request without recording request payloads", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]);
    const service = new AuthAuditService({ execute } as unknown as Pool);

    await runWithRequestContext("login-request-1", () =>
      service.record({
        eventType: "AUTH_LOGIN_FAILED",
        actorUserId: null,
        details: {
          loginIdHash: "a".repeat(64),
          ipHash: "b".repeat(64),
          reason: "INVALID_CREDENTIALS",
        },
      }),
    );

    expect(execute).toHaveBeenCalledWith(expect.stringContaining("request_id"), [
      "AUTH_LOGIN_FAILED",
      null,
      "login-request-1",
      expect.stringContaining("loginIdHash"),
    ]);
  });

  it.each([
    [
      "an undocumented raw login identifier",
      {
        eventType: "AUTH_LOGIN_FAILED",
        actorUserId: null,
        details: {
          loginIdHash: "a".repeat(64),
          ipHash: "b".repeat(64),
          reason: "INVALID_CREDENTIALS",
          loginId: "raw-login-id",
        },
      },
    ],
    [
      "a malformed hash",
      {
        eventType: "AUTH_LOGIN_FAILED",
        actorUserId: null,
        details: { loginIdHash: "not-a-hash", ipHash: "b".repeat(64), reason: "INVALID_CREDENTIALS" },
      },
    ],
    [
      "a reason that does not belong to the event",
      {
        eventType: "AUTH_LOGIN_SUCCEEDED",
        actorUserId: 1,
        details: { loginIdHash: "a".repeat(64), ipHash: "b".repeat(64), reason: "INVALID_CREDENTIALS" },
      },
    ],
    [
      "a successful event without an actor",
      {
        eventType: "AUTH_LOGIN_SUCCEEDED",
        actorUserId: null,
        details: { loginIdHash: "a".repeat(64), ipHash: "b".repeat(64), reason: "AUTHENTICATED" },
      },
    ],
    [
      "a caller-supplied request ID outside the context boundary",
      {
        eventType: "AUTH_LOGIN_FAILED",
        actorUserId: null,
        requestId: "caller-controlled",
        details: { loginIdHash: "a".repeat(64), ipHash: "b".repeat(64), reason: "INVALID_CREDENTIALS" },
      },
    ],
  ])("rejects %s without writing while preserving best-effort behavior", async (_label, invalid) => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]);
    const service = new AuthAuditService({ execute } as unknown as Pool);

    await expect(service.record(invalid as unknown as AuthAuditRecord)).resolves.toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not let an audit storage failure break the caller", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const service = new AuthAuditService({
      execute: vi.fn().mockRejectedValue(new Error("database unavailable")),
    } as unknown as Pool);

    await expect(
      service.record({
        eventType: "AUTH_LOGIN_FAILED",
        actorUserId: null,
        details: {
          loginIdHash: "a".repeat(64),
          ipHash: "b".repeat(64),
          reason: "INVALID_CREDENTIALS",
        },
      }),
    ).resolves.toBe(false);
  });
});
