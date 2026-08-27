import { createHash } from "node:crypto";
import { DEFAULT_LOGIN_RATE_LIMIT, type LoginRateLimitConfig } from "../config/login-rate-limit-config.js";

export {
  DEFAULT_LOGIN_RATE_LIMIT,
  type LoginRateLimitConfig,
  resolveLoginRateLimitConfig,
} from "../config/login-rate-limit-config.js";

export const AUTH_LOGIN_ATTEMPT_LIMITER = Symbol("AUTH_LOGIN_ATTEMPT_LIMITER");

export interface LoginAttemptIdentity {
  key: string;
  loginIdHash: string;
  ipHash: string;
}

interface LoginAttemptState {
  failures: number[];
  blockedUntil: number;
}

export interface LoginAttemptStatus {
  blocked: boolean;
  retryAfterMs: number;
}

export type LoginAttemptClock = () => number;

export class LoginAttemptLimiter {
  private readonly attempts = new Map<string, LoginAttemptState>();
  private readonly maxTrackedKeys: number;
  private nextSweepAt = 0;

  constructor(
    private readonly config: LoginRateLimitConfig,
    private readonly clock: LoginAttemptClock = Date.now,
  ) {
    this.maxTrackedKeys = config.maxTrackedKeys ?? DEFAULT_LOGIN_RATE_LIMIT.maxTrackedKeys;
    if (!Number.isSafeInteger(this.maxTrackedKeys) || this.maxTrackedKeys <= 0) {
      throw new Error("Login attempt tracked-key limit must be a positive integer.");
    }
  }

  check(key: string): LoginAttemptStatus {
    const now = this.clock();
    this.sweepExpired(now);
    const state = this.attempts.get(key);
    if (!state) return { blocked: false, retryAfterMs: 0 };

    if (state.blockedUntil > now) {
      return { blocked: true, retryAfterMs: state.blockedUntil - now };
    }

    if (state.blockedUntil > 0) {
      this.attempts.delete(key);
      return { blocked: false, retryAfterMs: 0 };
    }

    this.pruneFailures(state, now);
    if (state.failures.length === 0) this.attempts.delete(key);
    return { blocked: false, retryAfterMs: 0 };
  }

  registerFailure(key: string): LoginAttemptStatus {
    const now = this.clock();
    this.sweepExpired(now);
    const existing = this.attempts.get(key);
    const state =
      existing?.blockedUntil && existing.blockedUntil <= now
        ? { failures: [], blockedUntil: 0 }
        : (existing ?? { failures: [], blockedUntil: 0 });

    if (state.blockedUntil > now) {
      return { blocked: true, retryAfterMs: state.blockedUntil - now };
    }

    this.pruneFailures(state, now);
    state.failures.push(now);

    if (state.failures.length >= this.config.maxFailures) {
      state.failures = [];
      state.blockedUntil = now + this.config.blockDurationMs;
    }

    if (!this.attempts.has(key)) this.ensureCapacity(now);
    this.attempts.set(key, state);
    return state.blockedUntil > now
      ? { blocked: true, retryAfterMs: state.blockedUntil - now }
      : { blocked: false, retryAfterMs: 0 };
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  private pruneFailures(state: LoginAttemptState, now: number): void {
    const windowStart = now - this.config.failureWindowMs;
    state.failures = state.failures.filter((failedAt) => failedAt > windowStart);
  }

  private sweepExpired(now: number): void {
    if (now < this.nextSweepAt) return;
    const sweepIntervalMs = Math.min(this.config.failureWindowMs, this.config.blockDurationMs, 60_000);
    this.nextSweepAt = now + sweepIntervalMs;
    for (const [key, state] of this.attempts) {
      if (state.blockedUntil > 0) {
        if (state.blockedUntil <= now) this.attempts.delete(key);
        continue;
      }
      this.pruneFailures(state, now);
      if (state.failures.length === 0) this.attempts.delete(key);
    }
  }

  private ensureCapacity(now: number): void {
    if (this.attempts.size < this.maxTrackedKeys) return;

    for (const [key, state] of this.attempts) {
      if (state.blockedUntil <= now) {
        this.attempts.delete(key);
        break;
      }
    }

    if (this.attempts.size >= this.maxTrackedKeys) {
      const oldestKey = this.attempts.keys().next().value as string | undefined;
      if (oldestKey) this.attempts.delete(oldestKey);
    }
  }
}

export function normalizeLoginId(loginId: string): string {
  return loginId.trim().normalize("NFKC").toLowerCase();
}

export function createLoginAttemptIdentity(
  normalizedLoginId: string,
  clientIdentifier: string | undefined,
): LoginAttemptIdentity {
  const normalizedClientIdentifier = clientIdentifier?.trim().toLowerCase() || "unknown-client";
  const loginIdHash = sha256(normalizedLoginId);
  const ipHash = sha256(normalizedClientIdentifier);
  return {
    key: sha256(`${normalizedLoginId}\0${normalizedClientIdentifier}`),
    loginIdHash,
    ipHash,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
