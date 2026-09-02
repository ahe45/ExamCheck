import { describe, expect, it, vi } from "vitest";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import {
  IdentityBackfillProjectionError,
  IdentityBackfillProjectionRepository,
} from "./identity-backfill-projection.repository.js";

interface LegacyReservationSynchronizer {
  syncLegacyReservation(
    executor: SqlExecutor,
    source: { id: number; admissionName: string },
    pseudonymValue: number,
    examCycleId: number,
  ): Promise<void>;
}

describe("IdentityBackfillProjectionRepository legacy reservation", () => {
  it("never updates an immutable reservation and maps a duplicate insert to a PII-free conflict", async () => {
    const statements: string[] = [];
    const execute = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes("INSERT INTO legacy_pseudonym_reservation")) {
        throw {
          code: "ER_DUP_ENTRY",
          sqlMessage: "Duplicate entry 'PRIVATE-LEGACY-VALUE' for immutable reservation",
        };
      }
      return [[], []];
    });
    const executor = { execute, query: vi.fn() } as unknown as SqlExecutor;
    const repository = new IdentityBackfillProjectionRepository() as unknown as LegacyReservationSynchronizer;

    const error = await repository
      .syncLegacyReservation(executor, { id: 77, admissionName: "" }, 1501, 9)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IdentityBackfillProjectionError);
    expect(error).toMatchObject({
      code: "LEGACY_RESERVATION_CONFLICT",
      entityType: "pseudonym_assignment",
      sourceId: 77,
      details: {},
    });
    expect(String(error)).not.toContain("PRIVATE-LEGACY-VALUE");
    const insert = statements.find((sql) => sql.includes("INSERT INTO legacy_pseudonym_reservation"));
    expect(insert).toBeDefined();
    expect(insert).not.toContain("ON DUPLICATE KEY UPDATE");
    expect(statements.some((sql) => /UPDATE\s+legacy_pseudonym_reservation/i.test(sql))).toBe(false);
  });
});
