import { describe, expect, it } from "vitest";
import {
  DEFAULT_API_PORT,
  DEFAULT_DATABASE_CONNECTION_LIMIT,
  DEFAULT_DATABASE_PORT,
  resolveApiPort,
  resolveDatabaseRuntimeConfig,
} from "./runtime-config.js";

describe("runtime configuration", () => {
  it("keeps the established local defaults", () => {
    expect(resolveApiPort({})).toBe(DEFAULT_API_PORT);
    expect(resolveDatabaseRuntimeConfig({})).toEqual({
      host: "127.0.0.1",
      port: DEFAULT_DATABASE_PORT,
      user: "root",
      password: "",
      database: "examcheck",
      charset: "utf8mb4",
      connectionLimit: DEFAULT_DATABASE_CONNECTION_LIMIT,
    });
  });

  it("normalizes configured values", () => {
    expect(resolveApiPort({ PORT: " 4100 " })).toBe(4100);
    expect(
      resolveDatabaseRuntimeConfig({
        DB_HOST: " database.internal ",
        DB_PORT: "3307",
        DB_USER: " examcheck ",
        DB_PASSWORD: " secret ",
        DB_NAME: "examcheck_test",
        DB_CONNECTION_LIMIT: "24",
      }),
    ).toEqual({
      host: "database.internal",
      port: 3307,
      user: "examcheck",
      password: " secret ",
      database: "examcheck_test",
      charset: "utf8mb4",
      connectionLimit: 24,
    });
  });

  it.each([
    [{ PORT: "0" }, "PORT"],
    [{ PORT: "not-a-port" }, "PORT"],
    [{ DB_PORT: "70000" }, "DB_PORT"],
    [{ DB_CONNECTION_LIMIT: "0" }, "DB_CONNECTION_LIMIT"],
    [{ DB_CONNECTION_LIMIT: "1.5" }, "DB_CONNECTION_LIMIT"],
    [{ DB_NAME: "examcheck; DROP DATABASE" }, "DB_NAME"],
  ] as const)("rejects unsafe or invalid values (%s)", (environment, key) => {
    const resolve = key === "PORT" ? resolveApiPort : resolveDatabaseRuntimeConfig;
    expect(() => resolve(environment)).toThrow(key);
  });
});
