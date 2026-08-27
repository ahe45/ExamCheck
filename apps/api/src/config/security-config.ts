export type RuntimeEnvironment = "development" | "test" | "production";

export interface SecurityEnvironment {
  NODE_ENV?: string;
  JWT_SECRET?: string;
  JWT_SESSION_TTL_SECONDS?: string;
  JWT_ISSUER?: string;
  JWT_AUDIENCE?: string;
  JWT_CLOCK_TOLERANCE_SECONDS?: string;
  ADMIN_INITIAL_PASSWORD?: string;
  USER_INITIAL_PASSWORD?: string;
  OPERATOR_INITIAL_PASSWORD?: string;
  DEVELOPER_INITIAL_PASSWORD?: string;
}

export interface InitialAccountSeed {
  loginId: string;
  role: "ADMIN" | "OPERATOR" | "DEVELOPER";
  password: string;
}

export interface JwtSessionConfig {
  issuer: string;
  audience: string;
  ttlSeconds: number;
  clockToleranceSeconds: number;
}

export const DEVELOPMENT_JWT_SECRET = "examcheck-development-secret-change-me";
export const DEFAULT_JWT_ISSUER = "examcheck-api";
export const DEFAULT_JWT_AUDIENCE = "examcheck-web";
export const DEFAULT_JWT_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const DEFAULT_JWT_CLOCK_TOLERANCE_SECONDS = 30;
export const INITIAL_ACCOUNT_LOGIN_IDS = ["admin", "가번호", "dev"] as const;
const DEVELOPMENT_INITIAL_PASSWORD = "1234";
const DOCUMENTED_JWT_PLACEHOLDER = "replace-with-a-long-random-secret";
const PRODUCTION_JWT_SECRET_MIN_BYTES = 32;
const PRODUCTION_JWT_SECRET_MIN_BASE64URL_LENGTH = 43;
const PRODUCTION_JWT_SECRET_MIN_DISTINCT_CHARACTERS = 12;

export function resolveRuntimeEnvironment(value: string | undefined): RuntimeEnvironment {
  const normalized = value?.trim() || "development";
  if (normalized === "development" || normalized === "test" || normalized === "production") {
    return normalized;
  }
  throw new Error(`NODE_ENV must be development, test, or production. Received: ${normalized}`);
}

export function resolveJwtSecret(environment: SecurityEnvironment): string {
  const runtime = resolveRuntimeEnvironment(environment.NODE_ENV);
  const configured = nonBlank(environment.JWT_SECRET);

  if (runtime === "production") {
    if (!configured || configured === DEVELOPMENT_JWT_SECRET || configured === DOCUMENTED_JWT_PLACEHOLDER) {
      throw new Error("JWT_SECRET must be explicitly configured with a non-default value in production.");
    }
    if (!isStrongProductionJwtSecret(configured)) {
      throw new Error(
        "JWT_SECRET must be a base64url-encoded random value containing at least 32 bytes in production.",
      );
    }
    return configured;
  }

  return configured || DEVELOPMENT_JWT_SECRET;
}

function isStrongProductionJwtSecret(value: string): boolean {
  if (value.length < PRODUCTION_JWT_SECRET_MIN_BASE64URL_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  if (new Set(value).size < PRODUCTION_JWT_SECRET_MIN_DISTINCT_CHARACTERS) return false;
  try {
    return Buffer.from(value, "base64url").length >= PRODUCTION_JWT_SECRET_MIN_BYTES;
  } catch {
    return false;
  }
}

export function resolveJwtSessionConfig(environment: SecurityEnvironment): JwtSessionConfig {
  return {
    issuer: nonBlank(environment.JWT_ISSUER) || DEFAULT_JWT_ISSUER,
    audience: nonBlank(environment.JWT_AUDIENCE) || DEFAULT_JWT_AUDIENCE,
    ttlSeconds: configuredPositiveInteger(
      environment.JWT_SESSION_TTL_SECONDS,
      "JWT_SESSION_TTL_SECONDS",
      DEFAULT_JWT_SESSION_TTL_SECONDS,
    ),
    clockToleranceSeconds: configuredClockTolerance(environment.JWT_CLOCK_TOLERANCE_SECONDS),
  };
}

export function resolveInitialAccountSeeds(
  environment: SecurityEnvironment,
  requestedLoginIds: readonly string[] = INITIAL_ACCOUNT_LOGIN_IDS,
): InitialAccountSeed[] {
  const runtime = resolveRuntimeEnvironment(environment.NODE_ENV);
  const requested = new Set(requestedLoginIds);
  const unknownLoginId = [...requested].find(
    (loginId) => !INITIAL_ACCOUNT_LOGIN_IDS.some((initialLoginId) => initialLoginId === loginId),
  );
  if (unknownLoginId) throw new Error(`Unknown initial account login ID: ${unknownLoginId}`);

  const seeds: InitialAccountSeed[] = [];
  if (requested.has("admin")) {
    seeds.push({
      loginId: "admin",
      role: "ADMIN",
      password: initialPassword(environment.ADMIN_INITIAL_PASSWORD, "ADMIN_INITIAL_PASSWORD", runtime),
    });
  }
  if (requested.has("가번호")) {
    seeds.push({
      loginId: "가번호",
      role: "OPERATOR",
      password: initialPassword(
        firstNonBlank(environment.USER_INITIAL_PASSWORD, environment.OPERATOR_INITIAL_PASSWORD),
        "USER_INITIAL_PASSWORD",
        runtime,
      ),
    });
  }
  if (requested.has("dev")) {
    seeds.push({
      loginId: "dev",
      role: "DEVELOPER",
      password: initialPassword(environment.DEVELOPER_INITIAL_PASSWORD, "DEVELOPER_INITIAL_PASSWORD", runtime),
    });
  }

  return seeds;
}

function initialPassword(value: string | undefined, key: string, runtime: RuntimeEnvironment): string {
  const configured = nonBlank(value);
  if (runtime === "production") {
    if (!configured || configured === DEVELOPMENT_INITIAL_PASSWORD) {
      throw new Error(`${key} must be explicitly configured with a non-default value in production.`);
    }
    return configured;
  }
  return configured || DEVELOPMENT_INITIAL_PASSWORD;
}

function nonBlank(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  return values.map(nonBlank).find((value): value is string => value !== null);
}

function configuredPositiveInteger(value: string | undefined, key: string, defaultValue: number): number {
  const configured = nonBlank(value);
  if (!configured) return defaultValue;
  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return parsed;
}

function configuredClockTolerance(value: string | undefined): number {
  const configured = nonBlank(value);
  if (!configured) return DEFAULT_JWT_CLOCK_TOLERANCE_SECONDS;
  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 300) {
    throw new Error("JWT_CLOCK_TOLERANCE_SECONDS must be an integer between 0 and 300.");
  }
  return parsed;
}
