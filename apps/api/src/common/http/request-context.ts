import { monitorEventLoopDelay } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

export const REQUEST_ID_HEADER = "x-request-id";
export const MAX_REQUEST_ID_LENGTH = 128;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const requestIds = new WeakMap<object, string>();
export interface DatabaseMetrics {
  queries: number;
  rows: number;
  queryMs: number;
  acquireMs: number;
  transactionMs: number;
}
const requestContext = new AsyncLocalStorage<{ requestId: string; database?: DatabaseMetrics }>();
const delay = process.env.EXAMCHECK_PERFORMANCE_METRICS === "1" ? monitorEventLoopDelay({ resolution: 20 }) : null;
delay?.enable();
export function getCurrentDatabaseMetrics() {
  return requestContext.getStore()?.database;
}
function newDatabaseMetrics(): DatabaseMetrics | undefined {
  return process.env.EXAMCHECK_PERFORMANCE_METRICS === "1"
    ? { queries: 0, rows: 0, queryMs: 0, acquireMs: 0, transactionMs: 0 }
    : undefined;
}

export interface HttpRequestLike {
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  originalUrl?: string;
  route?: {
    path?: unknown;
  };
  url?: string;
}

export interface HttpResponseLike {
  once(event: "finish", listener: () => void): unknown;
  setHeader(name: string, value: string): unknown;
  statusCode: number;
  getHeader?(name: string): unknown;
  write?: (...args: unknown[]) => unknown;
  end?: (...args: unknown[]) => unknown;
}

export interface RequestCompletionLog {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  requestId: string;
}

export type RequestLogWriter = (serializedEntry: string) => void;

export interface RequestContextMiddlewareOptions {
  logWriter?: RequestLogWriter;
  now?: () => number;
}

export function isValidRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_REQUEST_ID_LENGTH &&
    REQUEST_ID_PATTERN.test(value)
  );
}

export function ensureRequestId(request: object, candidate?: unknown): string {
  const existing = requestIds.get(request);
  if (existing) return existing;

  const requestId = isValidRequestId(candidate) ? candidate : randomUUID();
  requestIds.set(request, requestId);
  return requestId;
}

export function getRequestId(request: object): string | undefined {
  return requestIds.get(request);
}

export function getCurrentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

export function runWithRequestContext<T>(requestId: string, work: () => T, database = newDatabaseMetrics()): T {
  if (!isValidRequestId(requestId)) throw new TypeError("Request context requires a valid request ID.");
  return requestContext.run({ requestId, database }, work);
}

export function createRequestContextMiddleware(options: RequestContextMiddlewareOptions = {}) {
  const logWriter = options.logWriter ?? writeRequestLog;
  const now = options.now ?? Date.now;

  return (request: HttpRequestLike, response: HttpResponseLike, next: () => void) => {
    const requestId = ensureRequestId(request, request.headers?.[REQUEST_ID_HEADER]);
    const startedAt = now();
    const database = newDatabaseMetrics();
    let bytes = 0;
    if (database)
      for (const key of ["write", "end"] as const) {
        const original = response[key];
        if (original)
          response[key] = function (...args: unknown[]) {
            const chunk = args[0];
            if (typeof chunk === "string")
              bytes += Buffer.byteLength(chunk, typeof args[1] === "string" ? (args[1] as BufferEncoding) : "utf8");
            else if (chunk instanceof Uint8Array) bytes += chunk.byteLength;
            return Reflect.apply(original, this, args);
          };
      }

    response.setHeader(REQUEST_ID_HEADER, requestId);
    response.once("finish", () => {
      const entry: RequestCompletionLog = {
        method: normalizeMethod(request.method),
        path: resolveRoutePath(request),
        statusCode: response.statusCode,
        durationMs: Math.max(0, now() - startedAt),
        requestId,
      };
      logWriter(
        JSON.stringify(
          database
            ? {
                ...entry,
                database: Object.fromEntries(
                  Object.entries(database).map(([key, value]) => [key, Math.round(value * 100) / 100]),
                ),
                responseBytes: bytes || Number(response.getHeader?.("content-length")) || 0,
                rssBytes: process.memoryUsage().rss,
                eventLoopP95Ms: delay ? Math.round(delay.percentile(95) / 1e4) / 100 : null,
              }
            : entry,
        ),
      );
    });

    runWithRequestContext(requestId, next, database);
  };
}

export function resolveRequestPath(request: HttpRequestLike): string {
  const rawPath = request.originalUrl ?? request.url ?? "/";
  const queryIndex = rawPath.indexOf("?");
  return queryIndex === -1 ? rawPath : rawPath.slice(0, queryIndex);
}

function resolveRoutePath(request: HttpRequestLike): string {
  const routePath = request.route?.path;
  // Only a framework-owned route template is safe for logs. Raw request paths
  // can contain a candidate number or other personally identifiable values.
  return typeof routePath === "string" && routePath.length > 0 ? routePath : "<unmatched>";
}

function normalizeMethod(method: string | undefined): string {
  return method?.toUpperCase() || "UNKNOWN";
}

function writeRequestLog(serializedEntry: string) {
  console.info(serializedEntry);
}
