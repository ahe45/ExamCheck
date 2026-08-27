import {
  defaultMigrationDirectory,
  loadDatabaseCliConfig,
  reportDatabaseCliFailure,
  withDatabaseConnection,
} from "./database-cli-runtime.js";
import { loadMigrationFiles, runMigrations, type MigrationEvent } from "./migration-runner.js";

async function migrate() {
  const config = loadDatabaseCliConfig();
  const migrations = await loadMigrationFiles(defaultMigrationDirectory());
  const result = await withDatabaseConnection(config, { createDatabase: true }, (connection) =>
    runMigrations(connection, migrations, logMigrationEvent),
  );
  console.log(
    `Database '${config.database}' migrations are ready ` +
      `(applied ${result.applied.length}, verified ${result.verified.length}, checksum backfilled ${result.checksumBackfilled.length}).`,
  );
}

function logMigrationEvent(event: MigrationEvent) {
  if (event.action === "APPLY") console.log(`Applied migration: ${event.version}`);
  if (event.action === "BACKFILL_CHECKSUM") {
    console.log(`Recorded checksum for existing migration: ${event.version}`);
  }
}

migrate().catch((error: unknown) => reportDatabaseCliFailure("Database migration", error));
