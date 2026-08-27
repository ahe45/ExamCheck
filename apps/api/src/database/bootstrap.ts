import { bootstrapInitialAccounts } from "./initial-account-bootstrap.js";
import { loadDatabaseCliConfig, reportDatabaseCliFailure, withDatabaseConnection } from "./database-cli-runtime.js";

async function bootstrap() {
  const config = loadDatabaseCliConfig();
  const result = await withDatabaseConnection(config, { createDatabase: false }, (connection) =>
    bootstrapInitialAccounts(connection, process.env),
  );

  for (const loginId of result.createdLoginIds) {
    console.log(`Created initial account: ${loginId}`);
  }
  console.log(
    result.createdLoginIds.length
      ? `Database '${config.database}' initial accounts are ready.`
      : `Database '${config.database}' initial accounts already exist.`,
  );
}

bootstrap().catch((error: unknown) => reportDatabaseCliFailure("Database bootstrap", error));
