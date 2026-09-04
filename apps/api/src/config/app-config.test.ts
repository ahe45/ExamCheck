import { describe, expect, it, vi } from "vitest";
import { DEFAULT_FRONTEND_ORIGIN } from "../application-config.js";
import { DEFAULT_LOGIN_RATE_LIMIT } from "./login-rate-limit-config.js";
import { DEFAULT_PRINT_JOB_EXPIRY_SECONDS } from "./print-job-config.js";
import { DEFAULT_API_PORT } from "./runtime-config.js";
import { DEVELOPMENT_JWT_SECRET } from "./security-config.js";
import { APP_CONFIG_KEYS, DEFAULT_EXAM_NAME, readAppConfigEnvironment, resolveAppConfig } from "./app-config.js";

describe("typed application configuration", () => {
  it("composes the established development defaults into one immutable value", () => {
    const config = resolveAppConfig({});

    expect(config).toMatchObject({
      runtime: { environment: "development" },
      http: { port: DEFAULT_API_PORT, frontendOrigins: [DEFAULT_FRONTEND_ORIGIN] },
      database: {
        host: "127.0.0.1",
        port: 3306,
        user: "root",
        password: "",
        database: "examcheck",
        charset: "utf8mb4",
        connectionLimit: 10,
      },
      auth: {
        jwtSecret: DEVELOPMENT_JWT_SECRET,
        loginRateLimit: DEFAULT_LOGIN_RATE_LIMIT,
      },
      candidates: { defaultExamName: DEFAULT_EXAM_NAME },
      printJobs: { expirySeconds: DEFAULT_PRINT_JOB_EXPIRY_SECONDS },
      identityTransition: { enabled: false, shadowHmacSecret: null },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.auth.session)).toBe(true);
    expect(Object.isFrozen(config.http.frontendOrigins)).toBe(true);
  });

  it("normalizes every runtime slice once and keeps password whitespace intact", () => {
    const config = resolveAppConfig({
      NODE_ENV: "test",
      PORT: "4100",
      FRONTEND_ORIGINS: "https://one.example.test/, https://two.example.test",
      FRONTEND_ORIGIN: "https://legacy.example.test",
      DB_HOST: " database.internal ",
      DB_PORT: "3307",
      DB_USER: " examcheck ",
      DB_PASSWORD: " secret ",
      DB_NAME: "examcheck_test",
      DB_CONNECTION_LIMIT: "24",
      JWT_SECRET: "unit-test-secret",
      JWT_SESSION_TTL_SECONDS: "3600",
      JWT_ISSUER: "test-issuer",
      JWT_AUDIENCE: "test-audience",
      JWT_CLOCK_TOLERANCE_SECONDS: "5",
      AUTH_LOGIN_MAX_FAILURES: "7",
      AUTH_LOGIN_FAILURE_WINDOW_SECONDS: "12",
      AUTH_LOGIN_BLOCK_SECONDS: "34",
      AUTH_LOGIN_MAX_TRACKED_KEYS: "1234",
      DEFAULT_EXAM_NAME: "통합 설정 시험",
      PRINT_JOB_EXPIRY_SECONDS: "45",
      IDENTITY_TRANSITION_ENABLED: "true",
      IDENTITY_SHADOW_HMAC_SECRET: "0123456789abcdef0123456789abcdef",
    });

    expect(config).toMatchObject({
      runtime: { environment: "test" },
      http: {
        port: 4100,
        frontendOrigins: ["https://one.example.test", "https://two.example.test"],
      },
      database: {
        host: "database.internal",
        port: 3307,
        user: "examcheck",
        password: " secret ",
        database: "examcheck_test",
        connectionLimit: 24,
      },
      auth: {
        jwtSecret: "unit-test-secret",
        session: {
          issuer: "test-issuer",
          audience: "test-audience",
          ttlSeconds: 3600,
          clockToleranceSeconds: 5,
        },
        loginRateLimit: {
          maxFailures: 7,
          failureWindowMs: 12_000,
          blockDurationMs: 34_000,
          maxTrackedKeys: 1234,
        },
      },
      candidates: { defaultExamName: "통합 설정 시험" },
      printJobs: { expirySeconds: 45 },
      identityTransition: {
        enabled: false,
        shadowHmacSecret: null,
      },
    });
  });

  it("preserves the previous explicit empty exam-name behavior", () => {
    expect(resolveAppConfig({ DEFAULT_EXAM_NAME: "" }).candidates.defaultExamName).toBe("");
  });

  it("reads only the declared HTTP runtime keys through the typed environment boundary", () => {
    const getValue = vi.fn((key: (typeof APP_CONFIG_KEYS)[number]) =>
      key === "DEFAULT_EXAM_NAME" ? "설정 경계 시험" : undefined,
    );

    const environment = readAppConfigEnvironment(getValue);

    expect(getValue.mock.calls.map(([key]) => key)).toEqual(APP_CONFIG_KEYS);
    expect(environment.DEFAULT_EXAM_NAME).toBe("설정 경계 시험");
    expect(environment).not.toHaveProperty("ADMIN_INITIAL_PASSWORD");
  });

  it.each([
    [{ PORT: "0" }, "PORT"],
    [{ DB_PORT: "70000" }, "DB_PORT"],
    [{ AUTH_LOGIN_MAX_FAILURES: "0" }, "AUTH_LOGIN_MAX_FAILURES"],
    [{ PRINT_JOB_EXPIRY_SECONDS: "" }, "PRINT_JOB_EXPIRY_SECONDS"],
    [{ NODE_ENV: "production" }, "JWT_SECRET"],
  ] as const)("fails before consumers receive an invalid configuration (%s)", (environment, key) => {
    expect(() => resolveAppConfig(environment)).toThrow(key);
  });
});
