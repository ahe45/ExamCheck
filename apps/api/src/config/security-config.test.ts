import { describe, expect, it } from "vitest";
import {
  DEFAULT_JWT_AUDIENCE,
  DEFAULT_JWT_CLOCK_TOLERANCE_SECONDS,
  DEFAULT_JWT_ISSUER,
  DEFAULT_JWT_SESSION_TTL_SECONDS,
  DEVELOPMENT_JWT_SECRET,
  INITIAL_ACCOUNT_LOGIN_IDS,
  resolveInitialAccountSeeds,
  resolveJwtSecret,
  resolveJwtSessionConfig,
  resolveRuntimeEnvironment,
} from "./security-config.js";

describe("security configuration", () => {
  it("keeps the current local development defaults", () => {
    expect(resolveRuntimeEnvironment(undefined)).toBe("development");
    expect(resolveJwtSecret({})).toBe(DEVELOPMENT_JWT_SECRET);
    expect(resolveInitialAccountSeeds({}).map((seed) => seed.password)).toEqual(["1234", "1234", "1234"]);
  });

  it("rejects the default JWT secret in production", () => {
    expect(() => resolveJwtSecret({ NODE_ENV: "production" })).toThrow("JWT_SECRET");
    expect(() =>
      resolveJwtSecret({
        NODE_ENV: "production",
        JWT_SECRET: DEVELOPMENT_JWT_SECRET,
      }),
    ).toThrow("JWT_SECRET");
    expect(() =>
      resolveJwtSecret({
        NODE_ENV: "production",
        JWT_SECRET: "replace-with-a-long-random-secret",
      }),
    ).toThrow("JWT_SECRET");
  });

  it("accepts an explicitly configured production JWT secret", () => {
    const secret = "Qm9wM0tZRW5wZ29LeW9KVF9OWFZVd0twMGVmS2o0bXh4dFU";
    expect(
      resolveJwtSecret({
        NODE_ENV: "production",
        JWT_SECRET: secret,
      }),
    ).toBe(secret);
  });

  it("rejects short and low-entropy production JWT secrets", () => {
    expect(() => resolveJwtSecret({ NODE_ENV: "production", JWT_SECRET: "x" })).toThrow("at least 32 bytes");
    expect(() =>
      resolveJwtSecret({ NODE_ENV: "production", JWT_SECRET: Buffer.alloc(31, 7).toString("base64url") }),
    ).toThrow("at least 32 bytes");
    expect(() => resolveJwtSecret({ NODE_ENV: "production", JWT_SECRET: "a".repeat(43) })).toThrow("at least 32 bytes");
  });

  it("resolves bounded session token settings and rejects unsafe numeric values", () => {
    expect(resolveJwtSessionConfig({})).toEqual({
      issuer: DEFAULT_JWT_ISSUER,
      audience: DEFAULT_JWT_AUDIENCE,
      ttlSeconds: DEFAULT_JWT_SESSION_TTL_SECONDS,
      clockToleranceSeconds: DEFAULT_JWT_CLOCK_TOLERANCE_SECONDS,
    });
    expect(
      resolveJwtSessionConfig({
        JWT_SESSION_TTL_SECONDS: "3600",
        JWT_ISSUER: "examcheck-test-api",
        JWT_AUDIENCE: "examcheck-test-web",
        JWT_CLOCK_TOLERANCE_SECONDS: "15",
      }),
    ).toEqual({
      issuer: "examcheck-test-api",
      audience: "examcheck-test-web",
      ttlSeconds: 3600,
      clockToleranceSeconds: 15,
    });
    expect(() => resolveJwtSessionConfig({ JWT_SESSION_TTL_SECONDS: "0" })).toThrow("JWT_SESSION_TTL_SECONDS");
    expect(() => resolveJwtSessionConfig({ JWT_SESSION_TTL_SECONDS: "1.5" })).toThrow("JWT_SESSION_TTL_SECONDS");
    expect(() => resolveJwtSessionConfig({ JWT_CLOCK_TOLERANCE_SECONDS: "301" })).toThrow(
      "JWT_CLOCK_TOLERANCE_SECONDS",
    );
  });

  it("rejects missing or default initial passwords in production", () => {
    expect(() => resolveInitialAccountSeeds({ NODE_ENV: "production" })).toThrow("ADMIN_INITIAL_PASSWORD");
    expect(() =>
      resolveInitialAccountSeeds({
        NODE_ENV: "production",
        ADMIN_INITIAL_PASSWORD: "1234",
        USER_INITIAL_PASSWORD: "user-secret",
        DEVELOPER_INITIAL_PASSWORD: "developer-secret",
      }),
    ).toThrow("ADMIN_INITIAL_PASSWORD");
    expect(() =>
      resolveInitialAccountSeeds({
        NODE_ENV: "production",
        ADMIN_INITIAL_PASSWORD: "admin-secret",
        DEVELOPER_INITIAL_PASSWORD: "developer-secret",
      }),
    ).toThrow("USER_INITIAL_PASSWORD");
    expect(() =>
      resolveInitialAccountSeeds({
        NODE_ENV: "production",
        ADMIN_INITIAL_PASSWORD: "admin-secret",
        USER_INITIAL_PASSWORD: "user-secret",
      }),
    ).toThrow("DEVELOPER_INITIAL_PASSWORD");
  });

  it("resolves explicitly configured production bootstrap accounts", () => {
    expect(
      resolveInitialAccountSeeds({
        NODE_ENV: "production",
        ADMIN_INITIAL_PASSWORD: "admin-secret",
        OPERATOR_INITIAL_PASSWORD: "operator-secret",
        DEVELOPER_INITIAL_PASSWORD: "developer-secret",
      }),
    ).toEqual([
      { loginId: "admin", role: "ADMIN", password: "admin-secret" },
      { loginId: "가번호", role: "OPERATOR", password: "operator-secret" },
      { loginId: "dev", role: "DEVELOPER", password: "developer-secret" },
    ]);
  });

  it("requires production passwords only for accounts that still need bootstrap", () => {
    expect(resolveInitialAccountSeeds({ NODE_ENV: "production" }, [])).toEqual([]);
    expect(
      resolveInitialAccountSeeds(
        {
          NODE_ENV: "production",
          DEVELOPER_INITIAL_PASSWORD: "developer-secret",
        },
        ["dev"],
      ),
    ).toEqual([{ loginId: "dev", role: "DEVELOPER", password: "developer-secret" }]);
    expect(INITIAL_ACCOUNT_LOGIN_IDS).toEqual(["admin", "가번호", "dev"]);
  });

  it("rejects unknown bootstrap account identifiers", () => {
    expect(() => resolveInitialAccountSeeds({}, ["unexpected"])).toThrow("Unknown initial account login ID");
  });

  it("keeps the legacy operator password variable as a fallback for blank user values", () => {
    const seeds = resolveInitialAccountSeeds({
      USER_INITIAL_PASSWORD: "   ",
      OPERATOR_INITIAL_PASSWORD: "operator-secret",
    });

    expect(seeds[1]?.password).toBe("operator-secret");
  });

  it("rejects unknown runtime environment names", () => {
    expect(() => resolveRuntimeEnvironment("prod")).toThrow("NODE_ENV must be development, test, or production");
  });
});
