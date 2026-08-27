import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Connection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export interface MigrationFile {
  version: string;
  sql: string;
  checksum: string;
}

export type MigrationAction = "APPLY" | "BACKFILL_CHECKSUM" | "VERIFY";

export type MigrationStatus = "APPLYING" | "APPLIED" | "FAILED";

export interface MigrationRunResult {
  applied: string[];
  checksumBackfilled: string[];
  verified: string[];
}

export interface MigrationEvent {
  action: MigrationAction;
  version: string;
}

export interface MigrationRunOptions {
  lockTimeoutSeconds?: number;
}

export const MIGRATION_ADVISORY_LOCK_NAME = "examcheck_schema_migration_v1";
export const DEFAULT_MIGRATION_LOCK_TIMEOUT_SECONDS = 30;

export type MigrationConnection = Pick<Connection, "query" | "execute" | "beginTransaction" | "commit" | "rollback">;

interface MigrationRecordRow extends RowDataPacket {
  version: string;
  checksum: string | null;
  status: MigrationStatus | string;
}

interface SchemaColumnRow extends RowDataPacket {
  Field: string;
}

interface AdvisoryLockRow extends RowDataPacket {
  acquired: number | null;
}

interface AdvisoryUnlockRow extends RowDataPacket {
  released: number | null;
}

interface MigrationPlanItem {
  migration: MigrationFile;
  action: MigrationAction;
}

export async function loadMigrationFiles(directory: string): Promise<MigrationFile[]> {
  const versions = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();

  return Promise.all(
    versions.map(async (version) => {
      const contents = await readFile(resolve(directory, version));
      return {
        version,
        sql: contents.toString("utf8"),
        checksum: calculateMigrationChecksum(contents),
      };
    }),
  );
}

export function calculateMigrationChecksum(contents: string | Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

export function decideMigrationAction(
  version: string,
  recorded: { checksum: string | null } | undefined,
  currentChecksum: string,
): MigrationAction {
  if (!recorded) return "APPLY";
  if (recorded.checksum === null) return "BACKFILL_CHECKSUM";
  if (recorded.checksum === currentChecksum) return "VERIFY";
  throw new Error(
    `Migration checksum mismatch: ${version}. ` +
      `Recorded ${recorded.checksum}, current ${currentChecksum}. ` +
      "Applied migration files must not be modified.",
  );
}

export async function runMigrations(
  connection: MigrationConnection,
  migrations: readonly MigrationFile[],
  onEvent?: (event: MigrationEvent) => void,
  options: MigrationRunOptions = {},
): Promise<MigrationRunResult> {
  assertUniqueMigrationVersions(migrations);
  const lockTimeoutSeconds = resolveLockTimeout(options.lockTimeoutSeconds);
  await acquireMigrationLock(connection, lockTimeoutSeconds);

  let result: MigrationRunResult | undefined;
  let migrationError: unknown;
  try {
    result = await runMigrationsWithLock(connection, migrations, onEvent);
  } catch (error) {
    migrationError = error;
  }

  let releaseError: unknown;
  try {
    await releaseMigrationLock(connection);
  } catch (error) {
    releaseError = error;
  }

  if (migrationError !== undefined && releaseError !== undefined) {
    throw new AggregateError(
      [migrationError, releaseError],
      "Migration execution failed and the advisory lock could not be released.",
      { cause: migrationError },
    );
  }
  if (migrationError !== undefined) throw migrationError;
  if (releaseError !== undefined) throw releaseError;
  if (!result) throw new Error("Migration execution completed without a result.");
  return result;
}

async function runMigrationsWithLock(
  connection: MigrationConnection,
  migrations: readonly MigrationFile[],
  onEvent?: (event: MigrationEvent) => void,
): Promise<MigrationRunResult> {
  await ensureMigrationSchema(connection);

  const [appliedRecords] = await connection.execute<MigrationRecordRow[]>(
    "SELECT version, checksum, status FROM schema_migration ORDER BY version",
  );
  assertNoDirtyMigrationRecords(appliedRecords);
  assertAppliedMigrationFilesPresent(appliedRecords, migrations);
  const appliedByVersion = new Map(appliedRecords.map((record) => [record.version, record]));

  const plan: MigrationPlanItem[] = [];
  for (const migration of migrations) {
    plan.push({
      migration,
      action: decideMigrationAction(migration.version, appliedByVersion.get(migration.version), migration.checksum),
    });
  }

  const result: MigrationRunResult = { applied: [], checksumBackfilled: [], verified: [] };
  for (const item of plan) {
    if (item.action === "VERIFY") {
      result.verified.push(item.migration.version);
      onEvent?.({ action: item.action, version: item.migration.version });
      continue;
    }
    if (item.action === "BACKFILL_CHECKSUM") {
      await connection.execute("UPDATE schema_migration SET checksum = ? WHERE version = ? AND checksum IS NULL", [
        item.migration.checksum,
        item.migration.version,
      ]);
      result.checksumBackfilled.push(item.migration.version);
      onEvent?.({ action: item.action, version: item.migration.version });
      continue;
    }

    await connection.execute("INSERT INTO schema_migration(version, checksum, status) VALUES (?, ?, 'APPLYING')", [
      item.migration.version,
      item.migration.checksum,
    ]);
    try {
      await connection.beginTransaction();
      await connection.query(item.migration.sql);
      const [statusResult] = await connection.execute<ResultSetHeader>(
        "UPDATE schema_migration SET status = 'APPLIED' WHERE version = ? AND status = 'APPLYING'",
        [item.migration.version],
      );
      if (statusResult.affectedRows !== 1) {
        throw new Error("Migration metadata did not transition from APPLYING to APPLIED.");
      }
      await connection.commit();
    } catch (error) {
      throw await recordMigrationFailure(connection, item.migration.version, error);
    }
    result.applied.push(item.migration.version);
    onEvent?.({ action: item.action, version: item.migration.version });
  }

  return result;
}

async function acquireMigrationLock(connection: MigrationConnection, timeoutSeconds: number) {
  const [rows] = await connection.execute<AdvisoryLockRow[]>("SELECT GET_LOCK(?, ?) AS acquired", [
    MIGRATION_ADVISORY_LOCK_NAME,
    timeoutSeconds,
  ]);
  const acquired = rows[0]?.acquired;
  if (acquired === null || acquired === undefined) {
    throw new Error("Database failed to acquire the migration advisory lock.");
  }
  if (Number(acquired) === 1) return;
  if (Number(acquired) === 0) {
    const unit = timeoutSeconds === 1 ? "second" : "seconds";
    throw new Error(
      `Could not acquire migration advisory lock within ${timeoutSeconds} ${unit}. ` +
        "Another database migration may still be running.",
    );
  }
  throw new Error(`Database returned an unexpected migration lock result: ${String(acquired)}.`);
}

async function releaseMigrationLock(connection: MigrationConnection) {
  const [rows] = await connection.execute<AdvisoryUnlockRow[]>("SELECT RELEASE_LOCK(?) AS released", [
    MIGRATION_ADVISORY_LOCK_NAME,
  ]);
  if (Number(rows[0]?.released) !== 1) {
    throw new Error("Database failed to release the migration advisory lock.");
  }
}

function resolveLockTimeout(value: number | undefined) {
  const timeout = value ?? DEFAULT_MIGRATION_LOCK_TIMEOUT_SECONDS;
  if (!Number.isInteger(timeout) || timeout < 0 || timeout > 300) {
    throw new Error("Migration lock timeout must be an integer between 0 and 300 seconds.");
  }
  return timeout;
}

async function ensureMigrationSchema(connection: MigrationConnection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version VARCHAR(100) PRIMARY KEY,
      checksum CHAR(64) NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'APPLIED',
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [checksumColumns] = await connection.query<SchemaColumnRow[]>(
    "SHOW COLUMNS FROM schema_migration LIKE 'checksum'",
  );
  if (!checksumColumns.length) {
    await connection.query("ALTER TABLE schema_migration ADD COLUMN checksum CHAR(64) NULL AFTER version");
  }

  const [statusColumns] = await connection.query<SchemaColumnRow[]>("SHOW COLUMNS FROM schema_migration LIKE 'status'");
  if (!statusColumns.some((column) => column.Field === "status")) {
    await connection.query(
      "ALTER TABLE schema_migration ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'APPLIED' AFTER checksum",
    );
  }
}

async function recordMigrationFailure(connection: MigrationConnection, version: string, cause: unknown) {
  const migrationError = new Error(`Migration failed: ${version}`, { cause });
  const recoveryErrors: unknown[] = [];

  try {
    await connection.rollback();
  } catch (error) {
    recoveryErrors.push(error);
  }

  try {
    const [statusResult] = await connection.execute<ResultSetHeader>(
      "UPDATE schema_migration SET status = 'FAILED' WHERE version = ? AND status = 'APPLYING'",
      [version],
    );
    if (statusResult.affectedRows !== 1) {
      throw new Error("Migration metadata did not transition from APPLYING to FAILED.");
    }
  } catch (error) {
    recoveryErrors.push(error);
  }

  if (recoveryErrors.length === 0) return migrationError;
  return new AggregateError(
    [migrationError, ...recoveryErrors],
    `Migration failed and its dirty state could not be finalized: ${version}`,
    { cause: migrationError },
  );
}

function assertUniqueMigrationVersions(migrations: readonly MigrationFile[]) {
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version}`);
    }
    seen.add(migration.version);
  }
}

function assertAppliedMigrationFilesPresent(
  appliedRecords: readonly MigrationRecordRow[],
  migrations: readonly MigrationFile[],
) {
  const available = new Set(migrations.map((migration) => migration.version));
  const missing = appliedRecords.find((record) => !available.has(record.version));
  if (missing) {
    throw new Error(
      `Applied migration file is missing: ${missing.version}. ` +
        "Restore the original file before running migrations.",
    );
  }
}

function assertNoDirtyMigrationRecords(records: readonly MigrationRecordRow[]) {
  const dirty = records.filter((record) => record.status !== "APPLIED");
  if (!dirty.length) return;

  const summary = dirty.map((record) => `${record.version} (${record.status})`).join(", ");
  throw new Error(
    `Dirty migration state detected: ${summary}. ` +
      "Further migrations are blocked until an approved forward repair or database restore is completed.",
  );
}
