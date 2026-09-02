import { describe, expect, it, vi } from "vitest";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { CandidateIdentityRepository, IdentityProjectionConflictError } from "./candidate-identity.repository.js";

interface AdmissionResolver {
  resolveAdmission(
    executor: SqlExecutor,
    examCycleId: number,
    source: { id: number; admission: string; admissionCode: string },
  ): Promise<number>;
}

describe("CandidateIdentityRepository admission resolution", () => {
  it("resolves the name alias before insertion and enriches the same admission with code and aliases", async () => {
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const execute = vi.fn(async (sql: string, values: readonly unknown[] = []) => {
      calls.push({ sql, values });
      if (sql.includes("FROM admission_identity_alias") && sql.includes("alias_key IN")) {
        return [[{ admissionId: 41 }], []];
      }
      if (sql.includes("FROM admission\n")) {
        return [
          [
            {
              id: 41,
              sourceCode: null,
              canonicalName: "A 전형",
              identityKey: Buffer.alloc(32),
            },
          ],
          [],
        ];
      }
      if (sql.includes("FROM admission_identity_alias") && sql.includes("alias_key = ?")) {
        return [[{ admissionId: 41 }], []];
      }
      return [{ affectedRows: 1, insertId: 0 }, []];
    });
    const executor = { execute, query: vi.fn() } as unknown as SqlExecutor;
    const repository = new CandidateIdentityRepository() as unknown as AdmissionResolver;

    await expect(
      repository.resolveAdmission(executor, 7, {
        id: 101,
        admission: " Ａ 전형 ",
        admissionCode: " a-01 ",
      }),
    ).resolves.toBe(41);

    expect(calls[0]?.sql).toContain("FROM admission_identity_alias");
    expect(calls.some((call) => call.sql.includes("INSERT INTO admission\n"))).toBe(false);
    const update = calls.find((call) => call.sql.includes("UPDATE admission\n"));
    expect(update?.values.slice(0, 3)).toEqual(["A-01", "A 전형", "A 전형"]);
    const aliasWrites = calls.filter((call) => call.sql.includes("INSERT INTO admission_identity_alias"));
    expect(aliasWrites.map((call) => call.values.slice(2, 4))).toEqual([
      ["NAME", "A 전형"],
      ["CODE", "A-01"],
    ]);
  });

  it("fails closed on aliases that resolve to different admissions without exposing source values", async () => {
    const execute = vi.fn(async () => [[{ admissionId: 11 }, { admissionId: 12 }], []]);
    const executor = { execute, query: vi.fn() } as unknown as SqlExecutor;
    const repository = new CandidateIdentityRepository() as unknown as AdmissionResolver;
    const source = {
      id: 202,
      admission: "PRIVATE ADMISSION NAME",
      admissionCode: "PRIVATE-CODE",
    };

    const error = await repository.resolveAdmission(executor, 7, source).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IdentityProjectionConflictError);
    expect(error).toMatchObject({
      code: "ADMISSION_ALIAS_CONFLICT",
      entityType: "candidate_record",
      sourceId: 202,
    });
    expect(String(error)).not.toContain(source.admission);
    expect(String(error)).not.toContain(source.admissionCode);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
