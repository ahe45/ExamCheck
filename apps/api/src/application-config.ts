import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { securityHeadersMiddleware } from "./config/http-security.js";
import { configureHttpBoundary, REQUEST_ID_HEADER, type RequestLogWriter } from "./common/http/http-boundary.js";

export const API_GLOBAL_PREFIX = "api/v1";
export const DEFAULT_FRONTEND_ORIGIN = "http://localhost:5173";

export interface ApplicationConfigOptions {
  /** @deprecated Use frontendOrigins for new callers. */
  frontendOrigin?: string;
  frontendOrigins?: readonly string[];
  requestLogWriter?: RequestLogWriter;
}

export interface FrontendOriginEnvironment {
  FRONTEND_ORIGINS?: string;
  FRONTEND_ORIGIN?: string;
}

export function configureApplication(app: INestApplication, options: ApplicationConfigOptions) {
  const allowedOrigins = new Set(resolveConfiguredOrigins(options));

  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.enableCors({
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      // Requests without Origin are not browser CORS requests (health agents,
      // server-to-server integrations, CLI tools) and remain supported.
      callback(null, origin === undefined || allowedOrigins.has(origin));
    },
  });
  configureHttpBoundary(app, { requestLogWriter: options.requestLogWriter });
  app.use(securityHeadersMiddleware);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  return app;
}

export function resolveFrontendOrigins(environment: FrontendOriginEnvironment): string[] {
  const pluralOrigins = splitOrigins(environment.FRONTEND_ORIGINS);
  const configuredOrigins = pluralOrigins.length > 0 ? pluralOrigins : splitOrigins(environment.FRONTEND_ORIGIN);

  return normalizeOrigins(configuredOrigins.length > 0 ? configuredOrigins : [DEFAULT_FRONTEND_ORIGIN]);
}

function resolveConfiguredOrigins(options: ApplicationConfigOptions): string[] {
  if (options.frontendOrigins && options.frontendOrigins.length > 0) {
    return normalizeOrigins(options.frontendOrigins);
  }
  return normalizeOrigins([options.frontendOrigin || DEFAULT_FRONTEND_ORIGIN]);
}

function splitOrigins(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? []
  );
}

function normalizeOrigins(origins: readonly string[]): string[] {
  return [...new Set(origins.map(normalizeOrigin))];
}

function normalizeOrigin(value: string): string {
  const configured = value.trim();
  if (configured === "*") {
    throw new Error("Wildcard FRONTEND_ORIGINS cannot be used with credentialed CORS.");
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error(`Invalid frontend origin: ${configured}`);
  }
  if (parsed.origin === "null" || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`Frontend origins must contain only scheme, host, and port: ${configured}`);
  }
  return parsed.origin;
}
