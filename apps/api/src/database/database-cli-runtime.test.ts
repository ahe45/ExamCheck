import { describe, expect, it } from "vitest";
import { resolveDatabaseCliConfig } from "./database-cli-runtime.js";

describe("database CLI configuration", () => {
  it("keeps the existing local defaults", () => {
    expect(resolveDatabaseCliConfig({})).toEqual({
      database: "examcheck",
      connection: {
        host: "127.0.0.1",
        port: 3306,
        user: "root",
        password: "",
        charset: "utf8mb4",
      },
    });
  });

  it("rejects unsafe database identifiers and invalid ports before connecting", () => {
    expect(() => resolveDatabaseCliConfig({ DB_NAME: "examcheck; DROP DATABASE" })).toThrow("DB_NAME");
    expect(() => resolveDatabaseCliConfig({ DB_PORT: "not-a-port" })).toThrow("DB_PORT");
    expect(() => resolveDatabaseCliConfig({ DB_PORT: "70000" })).toThrow("DB_PORT");
  });
});
