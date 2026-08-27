import { describe, expect, it } from "vitest";
import { buildInitialAccountInsert, missingInitialAccountLoginIds } from "./initial-account-seed.js";

describe("initial account seed", () => {
  it("inserts a missing account without updating an existing account", () => {
    const statement = buildInitialAccountInsert({ loginId: "admin", role: "ADMIN" }, "password-hash");

    expect(statement.sql).toContain("INSERT IGNORE INTO app_user");
    expect(statement.sql).not.toContain("ON DUPLICATE KEY UPDATE");
    expect(statement.sql).not.toMatch(/UPDATE\s+(?:password_hash|role|enabled)/i);
    expect(statement.values).toEqual(["admin", "ADMIN", "password-hash"]);
  });

  it("selects only bootstrap accounts that do not already exist", () => {
    expect(missingInitialAccountLoginIds(["system", "admin", "가번호", "dev"])).toEqual([]);
    expect(missingInitialAccountLoginIds(["system", "admin"])).toEqual(["가번호", "dev"]);
  });
});
