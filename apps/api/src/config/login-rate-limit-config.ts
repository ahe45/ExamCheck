export const DEFAULT_LOGIN_RATE_LIMIT = {
  maxFailures: 5,
  failureWindowMs: 5 * 60 * 1_000,
  blockDurationMs: 15 * 60 * 1_000,
  maxTrackedKeys: 10_000,
} as const;

export interface LoginRateLimitConfig {
  maxFailures: number;
  failureWindowMs: number;
  blockDurationMs: number;
  maxTrackedKeys?: number;
}

export interface LoginRateLimitEnvironment {
  AUTH_LOGIN_MAX_FAILURES?: string;
  AUTH_LOGIN_FAILURE_WINDOW_SECONDS?: string;
  AUTH_LOGIN_BLOCK_SECONDS?: string;
  AUTH_LOGIN_MAX_TRACKED_KEYS?: string;
}

type LoginRateLimitKey = keyof LoginRateLimitEnvironment;
type LoginRateLimitSource = LoginRateLimitEnvironment | ((key: LoginRateLimitKey) => string | undefined);

export function resolveLoginRateLimitConfig(source: LoginRateLimitSource): LoginRateLimitConfig {
  const getValue = typeof source === "function" ? source : (key: LoginRateLimitKey) => source[key];
  return {
    maxFailures: configuredPositiveInteger(
      getValue("AUTH_LOGIN_MAX_FAILURES"),
      "AUTH_LOGIN_MAX_FAILURES",
      DEFAULT_LOGIN_RATE_LIMIT.maxFailures,
    ),
    failureWindowMs: positiveSecondsAsMilliseconds(
      getValue("AUTH_LOGIN_FAILURE_WINDOW_SECONDS"),
      "AUTH_LOGIN_FAILURE_WINDOW_SECONDS",
      DEFAULT_LOGIN_RATE_LIMIT.failureWindowMs,
    ),
    blockDurationMs: positiveSecondsAsMilliseconds(
      getValue("AUTH_LOGIN_BLOCK_SECONDS"),
      "AUTH_LOGIN_BLOCK_SECONDS",
      DEFAULT_LOGIN_RATE_LIMIT.blockDurationMs,
    ),
    maxTrackedKeys: configuredPositiveInteger(
      getValue("AUTH_LOGIN_MAX_TRACKED_KEYS"),
      "AUTH_LOGIN_MAX_TRACKED_KEYS",
      DEFAULT_LOGIN_RATE_LIMIT.maxTrackedKeys,
    ),
  };
}

function configuredPositiveInteger(raw: string | undefined, key: string, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return parsed;
}

function positiveSecondsAsMilliseconds(raw: string | undefined, key: string, fallbackMs: number): number {
  const seconds = configuredPositiveInteger(raw, key, fallbackMs / 1_000);
  const milliseconds = seconds * 1_000;
  if (!Number.isSafeInteger(milliseconds)) {
    throw new Error(`${key} is too large.`);
  }
  return milliseconds;
}
