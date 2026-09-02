import { resolveFrontendOrigins, type FrontendOriginEnvironment } from "../application-config.js";
import {
  resolveLoginRateLimitConfig,
  type LoginRateLimitConfig,
  type LoginRateLimitEnvironment,
} from "./login-rate-limit-config.js";
import {
  resolveIdentityTransitionConfig,
  type IdentityTransitionConfig,
  type IdentityTransitionEnvironment,
} from "./identity-transition-config.js";
import { resolvePrintJobConfig, type PrintJobConfig, type PrintJobEnvironment } from "./print-job-config.js";
import {
  resolveApiPort,
  resolveDatabaseRuntimeConfig,
  type DatabaseRuntimeConfig,
  type RuntimeConfigEnvironment,
} from "./runtime-config.js";
import {
  resolveJwtSecret,
  resolveJwtSessionConfig,
  resolveRuntimeEnvironment,
  type JwtSessionConfig,
  type RuntimeEnvironment,
  type SecurityEnvironment,
} from "./security-config.js";

export const APP_CONFIG = Symbol("APP_CONFIG");
export const DEFAULT_EXAM_NAME = "2026년도 자격시험";
export const APP_CONFIG_KEYS = [
  "NODE_ENV",
  "PORT",
  "FRONTEND_ORIGINS",
  "FRONTEND_ORIGIN",
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "DB_CONNECTION_LIMIT",
  "JWT_SECRET",
  "JWT_SESSION_TTL_SECONDS",
  "JWT_ISSUER",
  "JWT_AUDIENCE",
  "JWT_CLOCK_TOLERANCE_SECONDS",
  "AUTH_LOGIN_MAX_FAILURES",
  "AUTH_LOGIN_FAILURE_WINDOW_SECONDS",
  "AUTH_LOGIN_BLOCK_SECONDS",
  "AUTH_LOGIN_MAX_TRACKED_KEYS",
  "DEFAULT_EXAM_NAME",
  "PRINT_JOB_EXPIRY_SECONDS",
  "IDENTITY_TRANSITION_ENABLED",
  "IDENTITY_SHADOW_HMAC_SECRET",
] as const;
export type AppConfigKey = (typeof APP_CONFIG_KEYS)[number];

export interface AppConfigEnvironment
  extends
    RuntimeConfigEnvironment,
    FrontendOriginEnvironment,
    SecurityEnvironment,
    LoginRateLimitEnvironment,
    PrintJobEnvironment,
    IdentityTransitionEnvironment {
  DEFAULT_EXAM_NAME?: string;
}

export interface AppConfig {
  runtime: Readonly<{
    environment: RuntimeEnvironment;
  }>;
  http: Readonly<{
    port: number;
    frontendOrigins: readonly string[];
  }>;
  database: Readonly<DatabaseRuntimeConfig>;
  auth: Readonly<{
    jwtSecret: string;
    session: Readonly<JwtSessionConfig>;
    loginRateLimit: Readonly<LoginRateLimitConfig>;
  }>;
  candidates: Readonly<{
    defaultExamName: string;
  }>;
  printJobs: Readonly<PrintJobConfig>;
  identityTransition: Readonly<IdentityTransitionConfig>;
}

export function readAppConfigEnvironment(getValue: (key: AppConfigKey) => string | undefined): AppConfigEnvironment {
  return Object.fromEntries(APP_CONFIG_KEYS.map((key) => [key, getValue(key)])) as AppConfigEnvironment;
}

export function resolveAppConfig(environment: AppConfigEnvironment): Readonly<AppConfig> {
  const runtimeEnvironment = resolveRuntimeEnvironment(environment.NODE_ENV);
  const session = Object.freeze(resolveJwtSessionConfig(environment));
  const loginRateLimit = Object.freeze(resolveLoginRateLimitConfig(environment));
  const frontendOrigins = Object.freeze(resolveFrontendOrigins(environment));

  return Object.freeze({
    runtime: Object.freeze({ environment: runtimeEnvironment }),
    http: Object.freeze({ port: resolveApiPort(environment), frontendOrigins }),
    database: Object.freeze(resolveDatabaseRuntimeConfig(environment)),
    auth: Object.freeze({
      jwtSecret: resolveJwtSecret(environment),
      session,
      loginRateLimit,
    }),
    candidates: Object.freeze({
      defaultExamName: environment.DEFAULT_EXAM_NAME === undefined ? DEFAULT_EXAM_NAME : environment.DEFAULT_EXAM_NAME,
    }),
    printJobs: Object.freeze(resolvePrintJobConfig(environment)),
    identityTransition: Object.freeze(resolveIdentityTransitionConfig(environment)),
  });
}
