export interface RuntimeConfigEnvironment {
  PORT?: string;
  DB_HOST?: string;
  DB_PORT?: string;
  DB_USER?: string;
  DB_PASSWORD?: string;
  DB_NAME?: string;
  DB_CONNECTION_LIMIT?: string;
}

export interface DatabaseRuntimeConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  charset: "utf8mb4";
  connectionLimit: number;
}

export const DEFAULT_API_PORT = 3100;
export const DEFAULT_DATABASE_PORT = 3306;
export const DEFAULT_DATABASE_CONNECTION_LIMIT = 10;

export function resolveApiPort(environment: RuntimeConfigEnvironment): number {
  return configuredInteger(environment.PORT, "PORT", DEFAULT_API_PORT, 1, 65_535);
}

export function resolveDatabaseRuntimeConfig(environment: RuntimeConfigEnvironment): DatabaseRuntimeConfig {
  const database = nonBlank(environment.DB_NAME) || "examcheck";
  if (!/^[a-zA-Z0-9_]+$/.test(database)) {
    throw new Error("DB_NAME may contain only letters, numbers, and underscores.");
  }

  return {
    host: nonBlank(environment.DB_HOST) || "127.0.0.1",
    port: configuredInteger(environment.DB_PORT, "DB_PORT", DEFAULT_DATABASE_PORT, 1, 65_535),
    user: nonBlank(environment.DB_USER) || "root",
    password: environment.DB_PASSWORD || "",
    database,
    charset: "utf8mb4",
    connectionLimit: configuredInteger(
      environment.DB_CONNECTION_LIMIT,
      "DB_CONNECTION_LIMIT",
      DEFAULT_DATABASE_CONNECTION_LIMIT,
      1,
      1_000,
    ),
  };
}

function configuredInteger(
  value: string | undefined,
  key: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const configured = nonBlank(value);
  if (!configured) return defaultValue;

  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function nonBlank(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
