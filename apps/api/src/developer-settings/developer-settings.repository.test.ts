import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { DeveloperSettingsRepository } from "./developer-settings.repository.js";

describe("DeveloperSettingsRepository", () => {
  it("returns only the aggregate count for policy conflict diagnostics", async () => {
    const query = vi.fn().mockResolvedValue([[{ conflictCount: "3" }], []]);
    const repository = new DeveloperSettingsRepository({} as Pool);

    await expect(repository.countSystemExamineeNumberConflicts({ query } as unknown as PoolConnection)).resolves.toBe(
      3,
    );
    expect(String(query.mock.calls[0][0])).not.toContain("SELECT name");
  });

  it("uses the fixed singleton profile key when updating settings", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]);
    const repository = new DeveloperSettingsRepository({} as Pool);

    await repository.updateProfile({ execute } as unknown as PoolConnection, {
      schoolName: "한국대학교",
      academicYear: 2026,
      systemName: "가번호 관리 시스템",
      examineeNoUniqueness: "SYSTEM",
      pseudonymNoUniqueness: "ADMISSION",
      updatedBy: 7,
    });

    expect(String(execute.mock.calls[0][0])).toContain("WHERE id = 1");
    expect(execute.mock.calls[0][1]).toEqual(["한국대학교", 2026, "가번호 관리 시스템", "SYSTEM", "ADMISSION", 7]);
  });
});
