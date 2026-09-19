import dotenv from "dotenv";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMigrationFiles, runMigrations } from "../src/database/migration-runner.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(apiRoot, "../..");
const migrationDirectory = resolve(apiRoot, "src/database/migrations");
const temporaryDatabasePattern = /^examcheck_it_[0-9a-f]{32}$/;
const createdDatabaseNames = new Set<string>();

dotenv.config({ path: resolve(projectRoot, ".env"), quiet: true });

export interface MariaDbIntegrationHarness {
  databaseName: string;
  pool: Pool;
  cleanup(): Promise<void>;
}

export interface MariaDbIntegrationHarnessOptions {
  migrateThrough?: string;
  connectionLimit?: number;
}

export async function createMariaDbIntegrationHarness(
  options: MariaDbIntegrationHarnessOptions = {},
): Promise<MariaDbIntegrationHarness> {
  const connectionConfig = integrationConnectionConfig();
  const databaseName = generateTemporaryDatabaseName();
  let pool: Pool | undefined;
  let databaseCreated = false;

  try {
    const administrator = await mysql.createConnection(connectionConfig);
    try {
      assertGeneratedDatabaseName(databaseName);
      await administrator.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      createdDatabaseNames.add(databaseName);
      databaseCreated = true;
    } finally {
      await administrator.end();
    }

    pool = mysql.createPool({
      ...connectionConfig,
      database: databaseName,
      multipleStatements: true,
      connectionLimit: options.connectionLimit ?? 6,
      waitForConnections: true,
    });
    await assertPoolUsesOwnedDatabase(pool, databaseName);
    await applyMigrations(pool, options);

    let cleaned = false;
    return {
      databaseName,
      pool,
      cleanup: async () => {
        if (cleaned) return;
        cleaned = true;
        await closePoolAndDropOwnedDatabase(pool as Pool, connectionConfig, databaseName);
      },
    };
  } catch (error) {
    let cleanupError: unknown;
    try {
      if (pool && databaseCreated) {
        await closePoolAndDropOwnedDatabase(pool, connectionConfig, databaseName);
      } else if (pool) {
        await pool.end();
      } else if (databaseCreated) {
        await dropOwnedDatabase(connectionConfig, databaseName);
      }
    } catch (cleanupFailure) {
      cleanupError = cleanupFailure;
    }
    if (cleanupError) {
      throw new AggregateError([error, cleanupError], "MariaDB integration harness setup and cleanup both failed.", {
        cause: error,
      });
    }
    throw error;
  }
}

async function applyMigrations(pool: Pool, options: MariaDbIntegrationHarnessOptions) {
  const allMigrations = await loadMigrationFiles(migrationDirectory);
  const migrations = selectMigrations(allMigrations, options.migrateThrough);
  assertCompleteMigrationSequence(migrations.map((migration) => migration.version));
  const connection = await pool.getConnection();
  try {
    const firstRun = await runMigrations(connection, migrations);
    if (firstRun.applied.length !== migrations.length) {
      throw new Error("Fresh integration database did not apply every migration.");
    }
    const verificationRun = await runMigrations(connection, migrations);
    if (verificationRun.verified.length !== migrations.length) {
      throw new Error("Integration migration verification did not verify every checksum.");
    }
  } finally {
    connection.release();
  }
}

function selectMigrations<T extends { version: string }>(migrations: readonly T[], migrateThrough?: string): T[] {
  if (!migrateThrough) return [...migrations];
  const lastIndex = migrations.findIndex((migration) => migration.version === migrateThrough);
  if (lastIndex < 0) throw new Error(`Requested integration migration was not found: ${migrateThrough}`);
  return migrations.slice(0, lastIndex + 1);
}

function assertCompleteMigrationSequence(files: readonly string[]) {
  if (files.length < 18) {
    throw new Error(`Integration harness requires at least migrations 001-018, but found ${files.length}.`);
  }
  files.forEach((file, index) => {
    const expectedPrefix = `${String(index + 1).padStart(3, "0")}_`;
    if (!file.startsWith(expectedPrefix)) {
      throw new Error(`Integration harness migration sequence is incomplete at ${expectedPrefix}: ${file}`);
    }
  });
}

function integrationConnectionConfig() {
  const port = Number(process.env.DB_PORT || "3306");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DB_PORT must be a valid TCP port for MariaDB integration tests.");
  }
  return {
    host: process.env.DB_HOST || "127.0.0.1",
    port,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    charset: "utf8mb4",
    connectTimeout: 10_000,
  };
}

function generateTemporaryDatabaseName() {
  const databaseName = `examcheck_it_${randomUUID().replaceAll("-", "")}`;
  assertGeneratedDatabaseName(databaseName);
  return databaseName;
}

function assertGeneratedDatabaseName(databaseName: string) {
  if (!temporaryDatabasePattern.test(databaseName)) {
    throw new Error(`Unsafe integration database name rejected: ${databaseName}`);
  }
}

function assertOwnedDatabaseName(databaseName: string) {
  assertGeneratedDatabaseName(databaseName);
  if (!createdDatabaseNames.has(databaseName)) {
    throw new Error(`Refusing to drop a database not created by this harness: ${databaseName}`);
  }
}

async function closePoolAndDropOwnedDatabase(
  pool: Pool,
  connectionConfig: ReturnType<typeof integrationConnectionConfig>,
  databaseName: string,
) {
  await assertPoolUsesOwnedDatabase(pool, databaseName);
  let closeError: unknown;
  try {
    await pool.end();
  } catch (error) {
    closeError = error;
  }

  let dropError: unknown;
  try {
    await dropOwnedDatabase(connectionConfig, databaseName);
  } catch (error) {
    dropError = error;
  }

  if (closeError || dropError) {
    throw new AggregateError(
      [closeError, dropError].filter((error) => error !== undefined),
      "Failed to clean up the MariaDB integration harness.",
    );
  }
}

async function dropOwnedDatabase(
  connectionConfig: ReturnType<typeof integrationConnectionConfig>,
  databaseName: string,
) {
  assertOwnedDatabaseName(databaseName);
  const administrator = await mysql.createConnection(connectionConfig);
  try {
    const [beforeRows] = await administrator.execute<Array<RowDataPacket & { schemaName: string }>>(
      `SELECT SCHEMA_NAME AS schemaName
       FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?`,
      [databaseName],
    );
    if (beforeRows.length !== 1 || beforeRows[0]?.schemaName !== databaseName) {
      throw new Error(`Owned integration database is missing or ambiguous before DROP: ${databaseName}`);
    }
    await administrator.query(`DROP DATABASE \`${databaseName}\``);
    const [afterRows] = await administrator.execute<Array<RowDataPacket & { schemaName: string }>>(
      `SELECT SCHEMA_NAME AS schemaName
       FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?`,
      [databaseName],
    );
    if (afterRows.length !== 0) {
      throw new Error(`Integration database still exists after DROP: ${databaseName}`);
    }
    createdDatabaseNames.delete(databaseName);
  } finally {
    await administrator.end();
  }
}

async function assertPoolUsesOwnedDatabase(pool: Pool, expectedDatabaseName: string) {
  assertOwnedDatabaseName(expectedDatabaseName);
  const [rows] = await pool.query<Array<RowDataPacket & { currentDatabase: string | null }>>(
    "SELECT DATABASE() AS currentDatabase",
  );
  if (rows.length !== 1 || rows[0]?.currentDatabase !== expectedDatabaseName) {
    throw new Error(`Refusing integration database cleanup: current database does not match ${expectedDatabaseName}.`);
  }
}
