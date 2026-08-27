import type { RowDataPacket } from "mysql2/promise";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  calculateMigrationChecksum,
  loadMigrationFiles,
  runMigrations,
  type MigrationFile,
} from "../src/database/migration-runner.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = resolve(apiRoot, "src/database/migrations");
const failedVersion = "999_integration_partial_ddl_failure.sql";
const rawSqlSentinel = "synthetic-value-that-must-not-be-stored";

describe("migration dirty-state protection", () => {
  let harness: MariaDbIntegrationHarness;

  beforeAll(async () => {
    harness = await createMariaDbIntegrationHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it("keeps partial DDL and a FAILED marker, then blocks a rerun without storing failure SQL", async () => {
    await harness.pool.query("CREATE TABLE migration_dirty_probe (id INT PRIMARY KEY) ENGINE=InnoDB");
    const sql = `
      ALTER TABLE migration_dirty_probe ADD COLUMN partial_value INT NULL;
      INSERT INTO migration_dirty_missing(value) VALUES ('${rawSqlSentinel}');
    `;
    const fixture: MigrationFile = {
      version: failedVersion,
      sql,
      checksum: calculateMigrationChecksum(sql),
    };
    const migrations = [...(await loadMigrationFiles(migrationsDirectory)), fixture];
    const connection = await harness.pool.getConnection();

    try {
      await expect(runMigrations(connection, migrations)).rejects.toThrow(`Migration failed: ${failedVersion}`);

      const [partialColumns] = await connection.query<Array<RowDataPacket & { Field: string }>>(
        "SHOW COLUMNS FROM migration_dirty_probe LIKE 'partial_value'",
      );
      expect(partialColumns).toHaveLength(1);

      const [failedRows] = await connection.execute<
        Array<RowDataPacket & { version: string; checksum: string; status: string }>
      >("SELECT version, checksum, status FROM schema_migration WHERE version = ?", [failedVersion]);
      expect(failedRows).toEqual([
        {
          version: failedVersion,
          checksum: fixture.checksum,
          status: "FAILED",
        },
      ]);
      expect(JSON.stringify(failedRows)).not.toContain(rawSqlSentinel);
      expect(JSON.stringify(failedRows)).not.toContain("migration_dirty_missing");

      await expect(runMigrations(connection, migrations)).rejects.toThrow(
        `Dirty migration state detected: ${failedVersion} (FAILED)`,
      );

      const [columnsAfterBlockedRerun] = await connection.query<Array<RowDataPacket & { Field: string }>>(
        "SHOW COLUMNS FROM migration_dirty_probe LIKE 'partial_value'",
      );
      expect(columnsAfterBlockedRerun).toHaveLength(1);
    } finally {
      connection.release();
    }
  });
});
