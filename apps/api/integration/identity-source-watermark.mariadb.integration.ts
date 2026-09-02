import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDENTITY_SOURCE_MUTATION_AUDIT_EVENT_TYPES } from "../src/identity-transition/identity-shadow-observation.repository.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

describe("identity source mutation watermark on MariaDB", () => {
  let harness: MariaDbIntegrationHarness;

  beforeAll(async () => {
    harness = await createMariaDbIntegrationHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it("ignores auth audits and serializes concurrent identity mutation commits on the singleton row", async () => {
    expect(await loadSequence()).toBe(0);
    await harness.pool.execute(
      `INSERT INTO audit_log (event_type, details)
       VALUES ('AUTH_LOGIN_SUCCEEDED', JSON_OBJECT('synthetic', TRUE))`,
    );
    expect(await loadSequence()).toBe(0);

    const first = await harness.pool.getConnection();
    const second = await harness.pool.getConnection();
    let secondSettled = false;
    try {
      await first.beginTransaction();
      await second.beginTransaction();
      await insertMutationAudit(first, "CANDIDATE_WORKBOOK_IMPORTED");
      const blockedInsert = insertMutationAudit(second, "PRINT_JOB_CREATED").then(() => {
        secondSettled = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(secondSettled).toBe(false);

      await first.commit();
      await blockedInsert;
      await second.commit();
      expect(await loadSequence()).toBe(2);
    } finally {
      await rollbackQuietly(first);
      await rollbackQuietly(second);
      first.release();
      second.release();
    }
  });

  it("keeps the database trigger allowlist aligned with the application mutation contract", async () => {
    const [rows] = await harness.pool.query<Array<RowDataPacket & { actionStatement: string }>>(
      `SELECT ACTION_STATEMENT AS actionStatement
       FROM information_schema.TRIGGERS
       WHERE TRIGGER_SCHEMA = DATABASE()
         AND TRIGGER_NAME = 'trg_audit_log_identity_source_mutation_watermark'`,
    );
    const actionStatement = rows[0]?.actionStatement ?? "";
    const databaseEvents = [...actionStatement.matchAll(/'([A-Z][A-Z_]+)'/g)].map((match) => match[1]!).sort();

    expect(databaseEvents).toEqual([...IDENTITY_SOURCE_MUTATION_AUDIT_EVENT_TYPES].sort());
    expect(actionStatement).not.toContain("AUTH_LOGIN_SUCCEEDED");
  });

  async function loadSequence(): Promise<number> {
    const [rows] = await harness.pool.query<Array<RowDataPacket & { sequence: number | string }>>(
      "SELECT sequence FROM identity_source_mutation_watermark WHERE id = 1",
    );
    return Number(rows[0]?.sequence ?? -1);
  }
});

async function insertMutationAudit(connection: PoolConnection, eventType: string): Promise<void> {
  await connection.execute(
    `INSERT INTO audit_log (event_type, details)
     VALUES (?, JSON_OBJECT('synthetic', TRUE))`,
    [eventType],
  );
}

async function rollbackQuietly(connection: PoolConnection): Promise<void> {
  try {
    await connection.rollback();
  } catch {
    // The assertion reports the primary failure; cleanup remains best effort.
  }
}
