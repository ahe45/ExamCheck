import { bootstrapInitialAccounts } from "./initial-account-bootstrap.js";
import {
  defaultMigrationDirectory,
  loadDatabaseCliConfig,
  reportDatabaseCliFailure,
  withDatabaseConnection,
} from "./database-cli-runtime.js";
import { loadMigrationFiles, runMigrations, type MigrationEvent } from "./migration-runner.js";

async function setup() {
  const config = loadDatabaseCliConfig();
  const migrations = await loadMigrationFiles(defaultMigrationDirectory());
  const bootstrap = await withDatabaseConnection(config, { createDatabase: true }, async (connection) => {
    await runMigrations(connection, migrations, logMigrationEvent);
    return bootstrapInitialAccounts(connection, process.env);
  });

  for (const loginId of bootstrap.createdLoginIds) {
    console.log(`Created initial account: ${loginId}`);
  }
  console.log(`Database '${config.database}' is ready.`);
}

function logMigrationEvent(event: MigrationEvent) {
  if (event.action === "APPLY") console.log(`Applied migration: ${event.version}`);
  if (event.action === "BACKFILL_CHECKSUM") {
    console.log(`Recorded checksum for existing migration: ${event.version}`);
  }
}

setup().catch((error: unknown) => reportDatabaseCliFailure("Database setup", error));
