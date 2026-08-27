import { describe, expect, it } from "vitest";
import {
  createLoginAttemptIdentity,
  LoginAttemptLimiter,
  normalizeLoginId,
  resolveLoginRateLimitConfig,
} from "./login-attempt-limiter.js";

describe("LoginAttemptLimiter", () => {
  it("blocks at the configured failure threshold and releases after the block", () => {
    let now = 10_000;
    const limiter = new LoginAttemptLimiter(
      {
        maxFailures: 3,
        failureWindowMs: 1_000,
        blockDurationMs: 5_000,
      },
      () => now,
    );

    expect(limiter.registerFailure("hashed-key").blocked).toBe(false);
    now += 100;
    expect(limiter.registerFailure("hashed-key").blocked).toBe(false);
    now += 100;
    expect(limiter.registerFailure("hashed-key")).toEqual({ blocked: true, retryAfterMs: 5_000 });

    now += 1_500;
    expect(limiter.check("hashed-key")).toEqual({ blocked: true, retryAfterMs: 3_500 });
    now += 3_500;
    expect(limiter.check("hashed-key")).toEqual({ blocked: false, retryAfterMs: 0 });
  });

  it("counts only failures inside the sliding window", () => {
    let now = 0;
    const limiter = new LoginAttemptLimiter(
      {
        maxFailures: 2,
        failureWindowMs: 1_000,
        blockDurationMs: 5_000,
      },
      () => now,
    );

    expect(limiter.registerFailure("hashed-key").blocked).toBe(false);
    now = 1_000;
    expect(limiter.registerFailure("hashed-key").blocked).toBe(false);
    now = 1_001;
    expect(limiter.registerFailure("hashed-key").blocked).toBe(true);
  });

  it("clears the entire key after a successful login", () => {
    const limiter = new LoginAttemptLimiter(
      {
        maxFailures: 2,
        failureWindowMs: 1_000,
        blockDurationMs: 5_000,
      },
      () => 100,
    );

    limiter.registerFailure("hashed-key");
    limiter.reset("hashed-key");

    expect(limiter.registerFailure("hashed-key").blocked).toBe(false);
  });

  it("bounds tracked identities and evicts an old non-blocked entry when full", () => {
    const limiter = new LoginAttemptLimiter({
      maxFailures: 2,
      failureWindowMs: 10_000,
      blockDurationMs: 10_000,
      maxTrackedKeys: 2,
    });

    limiter.registerFailure("oldest");
    limiter.registerFailure("second");
    limiter.registerFailure("third");

    expect(limiter.registerFailure("oldest").blocked).toBe(false);
    expect(limiter.registerFailure("oldest").blocked).toBe(true);
  });

  it("rejects an invalid tracked identity limit", () => {
    expect(
      () =>
        new LoginAttemptLimiter({
          maxFailures: 2,
          failureWindowMs: 10_000,
          blockDurationMs: 10_000,
          maxTrackedKeys: 0,
        }),
    ).toThrow("Login attempt tracked-key limit must be a positive integer.");
  });
});

describe("login attempt identity", () => {
  it("normalizes the login ID and stores only fixed-length hashes", () => {
    const normalized = normalizeLoginId("  ＡDMIN  ");
    const identity = createLoginAttemptIdentity(normalized, " 127.0.0.1 ");

    expect(normalized).toBe("admin");
    expect(identity.key).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.loginIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(identity)).not.toContain("admin");
    expect(JSON.stringify(identity)).not.toContain("127.0.0.1");
  });

  it("uses valid positive integer environment overrides", () => {
    const values: Record<string, string> = {
      AUTH_LOGIN_MAX_FAILURES: "7",
      AUTH_LOGIN_FAILURE_WINDOW_SECONDS: "12",
      AUTH_LOGIN_BLOCK_SECONDS: "34",
      AUTH_LOGIN_MAX_TRACKED_KEYS: "1234",
    };
    expect(resolveLoginRateLimitConfig((key) => values[key])).toEqual({
      maxFailures: 7,
      failureWindowMs: 12_000,
      blockDurationMs: 34_000,
      maxTrackedKeys: 1_234,
    });
  });

  it.each([
    ["AUTH_LOGIN_MAX_FAILURES", "0"],
    ["AUTH_LOGIN_FAILURE_WINDOW_SECONDS", "-1"],
    ["AUTH_LOGIN_BLOCK_SECONDS", String(Number.MAX_SAFE_INTEGER)],
    ["AUTH_LOGIN_MAX_TRACKED_KEYS", "1.5"],
  ])("fails fast for an invalid %s value", (key, value) => {
    expect(() => resolveLoginRateLimitConfig((requestedKey) => (requestedKey === key ? value : undefined))).toThrow(
      key,
    );
  });
});
