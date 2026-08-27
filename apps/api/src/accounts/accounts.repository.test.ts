import type { Pool } from "mysql2/promise";
import { describe, expect, it } from "vitest";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { AccountsRepository } from "./accounts.repository.js";

describe("AccountsRepository SQL mapping", () => {
  it("maps stored roles and assignments into the existing account response", async () => {
    const executor = new FixtureExecutor([
      [
        {
          id: 1,
          loginId: "admin",
          role: "ADMIN",
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-01"),
        },
        {
          id: 2,
          loginId: "operator",
          role: "OPERATOR",
          createdAt: new Date("2026-01-02"),
          updatedAt: new Date("2026-01-02"),
        },
      ],
      [
        { userId: 2, admissionName: "학생부교과" },
        { userId: 2, admissionName: "실기" },
      ],
    ]);

    await expect(new AccountsRepository().list(executor)).resolves.toEqual([
      expect.objectContaining({ id: 1, loginId: "admin", role: "ADMIN", admissionNames: [] }),
      expect.objectContaining({ id: 2, loginId: "operator", role: "USER", admissionNames: ["학생부교과", "실기"] }),
    ]);
    expect(executor.sql).toEqual([
      expect.stringContaining("role <> 'DEVELOPER'"),
      expect.stringContaining("FROM user_admission_assignment"),
    ]);
  });

  it("maps admission rows to names and keeps the executor explicit", async () => {
    const executor = new FixtureExecutor([[{ admissionName: "전형 A" }, { admissionName: "전형 B" }]]);

    await expect(new AccountsRepository().listAdmissionNames(executor)).resolves.toEqual(["전형 A", "전형 B"]);
    expect(executor.sql[0]).toContain("FROM candidate_record");
  });
});

class FixtureExecutor implements SqlExecutor {
  readonly sql: string[] = [];

  constructor(private readonly resultSets: unknown[]) {}

  query: Pool["query"] = ((sql: string) => {
    this.sql.push(sql);
    return Promise.resolve([this.resultSets.shift(), []]);
  }) as unknown as Pool["query"];

  execute: Pool["execute"] = ((sql: string) => {
    this.sql.push(sql);
    return Promise.resolve([this.resultSets.shift(), []]);
  }) as unknown as Pool["execute"];
}
