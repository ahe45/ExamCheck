import dotenv from "dotenv";
import mysql, { type Connection } from "mysql2/promise";
import { resolve } from "node:path";
import { resolveDatabaseRuntimeConfig } from "../config/runtime-config.js";

export interface DatabaseCliConfig {
  database: string;
  connection: {
    host: string;
    port: number;
    user: string;
    password: string;
    charset: string;
  };
}

export interface DatabaseConnectionOptions {
  createDatabase: boolean;
}

export function loadDatabaseCliConfig(): DatabaseCliConfig {
  dotenv.config({ path: resolve(process.cwd(), "../../.env"), quiet: true });
  return resolveDatabaseCliConfig(process.env);
}

export function resolveDatabaseCliConfig(environment: NodeJS.ProcessEnv): DatabaseCliConfig {
  const config = resolveDatabaseRuntimeConfig(environment);

  return {
    database: config.database,
    connection: {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      charset: config.charset,
    },
  };
}

export function defaultMigrationDirectory() {
  return resolve(process.cwd(), "src/database/migrations");
}

export async function withDatabaseConnection<T>(
  config: DatabaseCliConfig,
  options: DatabaseConnectionOptions,
  task: (connection: Connection) => Promise<T>,
): Promise<T> {
  if (options.createDatabase) await createDatabaseIfMissing(config);
  const connection = await mysql.createConnection({
    ...config.connection,
    database: config.database,
    multipleStatements: true,
  });
  try {
    return await task(connection);
  } finally {
    await connection.end();
  }
}

export function reportDatabaseCliFailure(label: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${label} failed:`, message);
  if (message.includes("auth_gssapi_client")) {
    console.error(
      "MariaDB requested Windows authentication, which this application's database driver does not support.\n" +
        "This can also happen when password authentication fails. Check DB_USER and DB_PASSWORD in the project .env.\n" +
        "On Windows, run start-server.bat --setup to enter the database credentials again.\n" +
        "Use a password-authenticated database account with permission to create and manage DB_NAME=examcheck.\n" +
        "If the account only supports Windows authentication, ask the database administrator for a separate password-authenticated account.",
    );
  }
  process.exitCode = 1;
}

async function createDatabaseIfMissing(config: DatabaseCliConfig) {
  const connection = await mysql.createConnection(config.connection);
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await connection.end();
  }
}
