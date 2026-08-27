import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadMigrationFiles,
  MIGRATION_ADVISORY_LOCK_NAME,
  runMigrations,
  type MigrationFile,
} from "../src/database/migration-runner.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let harness: MariaDbIntegrationHarness;
let migrations: MigrationFile[];

beforeAll(async () => {
  harness = await createMariaDbIntegrationHarness();
  migrations = await loadMigrationFiles(resolve(apiRoot, "src/database/migrations"));
});

afterAll(async () => {
  if (harness) await harness.cleanup();
});

describe("migration MariaDB advisory lock integration", () => {
  it("rejects a concurrent runner and succeeds after the holder releases the lock", async () => {
    const holder = await harness.pool.getConnection();
    const contender = await harness.pool.getConnection();
    let holderOwnsLock = false;
    try {
      const [acquiredRows] = await holder.execute<Array<RowDataPacket & { acquired: number | null }>>(
        "SELECT GET_LOCK(?, 0) AS acquired",
        [MIGRATION_ADVISORY_LOCK_NAME],
      );
      expect(Number(acquiredRows[0]?.acquired)).toBe(1);
      holderOwnsLock = true;

      await expect(runMigrations(contender, migrations, undefined, { lockTimeoutSeconds: 1 })).rejects.toThrow(
        "Could not acquire migration advisory lock within 1 second",
      );

      const [ownerRows] = await holder.execute<Array<RowDataPacket & { ownerId: number | null }>>(
        "SELECT IS_USED_LOCK(?) AS ownerId",
        [MIGRATION_ADVISORY_LOCK_NAME],
      );
      expect(Number(ownerRows[0]?.ownerId)).toBe(await connectionId(holder));

      const [releasedRows] = await holder.execute<Array<RowDataPacket & { released: number | null }>>(
        "SELECT RELEASE_LOCK(?) AS released",
        [MIGRATION_ADVISORY_LOCK_NAME],
      );
      expect(Number(releasedRows[0]?.released)).toBe(1);
      holderOwnsLock = false;

      const result = await runMigrations(contender, migrations, undefined, { lockTimeoutSeconds: 1 });
      expect(result.verified).toHaveLength(migrations.length);
    } finally {
      if (holderOwnsLock) {
        await holder.execute("SELECT RELEASE_LOCK(?)", [MIGRATION_ADVISORY_LOCK_NAME]);
      }
      holder.release();
      contender.release();
    }
  });
});

async function connectionId(connection: PoolConnection) {
  const [rows] = await connection.query<Array<RowDataPacket & { connectionId: number }>>(
    "SELECT CONNECTION_ID() AS connectionId",
  );
  return Number(rows[0]?.connectionId);
}
