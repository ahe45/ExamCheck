import type { RowDataPacket } from "mysql2/promise";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrationFiles, runMigrations } from "../src/database/migration-runner.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = resolve(apiRoot, "src/database/migrations");
const previousMigration = "025_print_job_request_fingerprint.sql";
const currentMigration = "026_expand_audit_request_id.sql";

describe("N-1 to latest migration upgrade", () => {
  let harness: MariaDbIntegrationHarness;

  beforeAll(async () => {
    harness = await createMariaDbIntegrationHarness({ migrateThrough: previousMigration });
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it("preserves existing data while widening audit request IDs in migration 026", async () => {
    const [identityRows] = await harness.pool.execute<
      Array<RowDataPacket & { userId: number; workstationId: number; templateId: number }>
    >(
      `SELECT u.id AS userId, w.id AS workstationId, lt.id AS templateId
       FROM app_user u
       INNER JOIN workstation w ON w.code = 'WS-DEV-001'
       INNER JOIN label_template lt ON lt.code = 'PRINTER_TEST'
       WHERE u.login_id = 'system' LIMIT 1`,
    );
    const identity = identityRows[0];
    if (!identity) throw new Error("N-1 fixture identity rows were not created.");

    const printJobId = "00000000-0000-4000-8000-000000000026";
    await harness.pool.execute(
      `INSERT INTO print_job
        (id, job_no, label_type, business_ref, template_id, template_version, workstation_id,
         requested_by, idempotency_key, copies, status, expires_at)
       VALUES (?, 'N1-UPGRADE-026', 'PSEUDONYM_LABEL', 'fixture', ?, 1, ?, ?,
               '00000000-0000-4000-8000-000000000025', 1, 'READY', DATE_ADD(NOW(3), INTERVAL 1 HOUR))`,
      [printJobId, identity.templateId, identity.workstationId, identity.userId],
    );

    const migrations = await loadMigrationFiles(migrationsDirectory);
    const connection = await harness.pool.getConnection();
    try {
      const upgrade = await runMigrations(connection, migrations);
      expect(upgrade.applied).toEqual([currentMigration]);
      expect(upgrade.verified).toHaveLength(migrations.length - 1);

      const verification = await runMigrations(connection, migrations);
      expect(verification.applied).toEqual([]);
      expect(verification.verified).toHaveLength(migrations.length);
    } finally {
      connection.release();
    }

    const [rows] = await harness.pool.execute<
      Array<RowDataPacket & { id: string; jobNo: string; requestFingerprint: string | null }>
    >(
      `SELECT id, job_no AS jobNo, request_fingerprint AS requestFingerprint
       FROM print_job WHERE id = ?`,
      [printJobId],
    );
    expect(rows).toEqual([{ id: printJobId, jobNo: "N1-UPGRADE-026", requestFingerprint: null }]);

    const [auditColumns] = await harness.pool.execute<Array<RowDataPacket & { characterMaximumLength: number | null }>>(
      `SELECT CHARACTER_MAXIMUM_LENGTH AS characterMaximumLength
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'audit_log'
          AND column_name = 'request_id'`,
    );
    expect(auditColumns).toEqual([{ characterMaximumLength: 128 }]);
  });
});
