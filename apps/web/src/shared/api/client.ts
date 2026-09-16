import type { z } from "zod";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api/v1";
const DEFAULT_API_TIMEOUT_MS = 60_000;
const INVALID_RESPONSE_MESSAGE = "서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.";

export interface ApiRequestInit extends RequestInit {
  timeoutMs?: number;
}

export interface ApiBlobResponse {
  blob: Blob;
  headers: Headers;
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function subscribeToUnauthorized(listener: UnauthorizedListener) {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export async function apiFetch<T>(
  path: string,
  options: ApiRequestInit = {},
  token?: string,
  schema?: z.ZodType<T>,
): Promise<T> {
  const response = await apiResponse(path, options, token);
  if (response.status === 204) return undefined as T;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw invalidResponseError(response);
  }
  if (!schema) return body as T;
  const result = schema.safeParse(body);
  if (!result.success) throw invalidResponseError(response);
  return result.data;
}

export async function apiBlob(path: string, options: ApiRequestInit = {}, token?: string): Promise<ApiBlobResponse> {
  const response = await apiResponse(path, options, token);
  return { blob: await response.blob(), headers: response.headers };
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function apiResponse(path: string, options: ApiRequestInit, token?: string): Promise<Response> {
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, signal: callerSignal, ...requestOptions } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("API 요청 제한 시간은 양수여야 합니다.");
  }
  const headers = new Headers(options.headers);
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const requestAbort = createRequestAbort(callerSignal, timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...requestOptions,
      headers,
      signal: requestAbort.signal,
    });
  } finally {
    requestAbort.dispose();
  }
  if (!response.ok) {
    const error = await toApiError(response);
    if (response.status === 401 && token) {
      for (const listener of unauthorizedListeners) listener();
    }
    throw error;
  }
  return response;
}

async function toApiError(response: Response): Promise<ApiError> {
  let message = `요청을 처리하지 못했습니다. (${response.status})`;
  let code: string | undefined;
  let requestId = response.headers.get("x-request-id") || undefined;
  try {
    const body = (await response.json()) as {
      message?: string | string[];
      code?: string;
      requestId?: string;
    };
    if (Array.isArray(body.message)) message = body.message.join(" ");
    else if (body.message) message = body.message;
    code = body.code;
    requestId = body.requestId || requestId;
  } catch {
    // Keep the status-based fallback for non-JSON responses.
  }
  return new ApiError(message, response.status, code, requestId);
}

function invalidResponseError(response: Response) {
  return new ApiError(
    INVALID_RESPONSE_MESSAGE,
    502,
    "INVALID_RESPONSE",
    response.headers.get("x-request-id") || undefined,
  );
}

function createRequestAbort(callerSignal: AbortSignal | null | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

  const timeoutId = globalThis.setTimeout(() => {
    controller.abort(new DOMException("요청 제한 시간이 초과되었습니다.", "TimeoutError"));
  }, timeoutMs);

  return {
    signal: controller.signal,
    dispose() {
      globalThis.clearTimeout(timeoutId);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}
