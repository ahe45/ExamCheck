import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { ensureRequestId, REQUEST_ID_HEADER, resolveRequestPath, type HttpRequestLike } from "./request-context.js";

export type StableHttpErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "HTTP_ERROR"
  | "INTERNAL_ERROR";

export interface HttpErrorEnvelope extends Record<string, unknown> {
  statusCode: number;
  message: string | string[];
  code: StableHttpErrorCode;
  path: string;
  requestId: string;
  timestamp: string;
}

@Catch()
export class HttpExceptionEnvelopeFilter implements ExceptionFilter {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequestLike>();
    const response = http.getResponse<unknown>();
    const requestId = ensureRequestId(request, request.headers?.[REQUEST_ID_HEADER]);
    const { statusCode, payload } = buildErrorPayload(exception);
    const envelope: HttpErrorEnvelope = {
      ...payload,
      statusCode,
      message: resolveMessage(exception, payload, statusCode),
      code: mapErrorCode(statusCode),
      path: resolveRequestPath(request),
      requestId,
      timestamp: new Date().toISOString(),
    };

    this.adapterHost.httpAdapter.setHeader(response, REQUEST_ID_HEADER, requestId);
    this.adapterHost.httpAdapter.reply(response, envelope, statusCode);
  }
}

function buildErrorPayload(exception: unknown): { statusCode: number; payload: Record<string, unknown> } {
  if (!(exception instanceof HttpException)) {
    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, payload: {} };
  }

  const statusCode = exception.getStatus();
  const response = exception.getResponse();
  if (typeof response === "string") return { statusCode, payload: {} };

  return {
    statusCode,
    payload: omitInternalErrorDetails(response),
  };
}

function omitInternalErrorDetails(response: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(response).filter(([key]) => key !== "stack" && key !== "cause"));
}

function resolveMessage(exception: unknown, payload: Record<string, unknown>, statusCode: number): string | string[] {
  if (!(exception instanceof HttpException)) return "서버에서 요청을 처리하지 못했습니다.";

  if (typeof payload.message === "string" || isStringArray(payload.message)) return payload.message;

  const response = exception.getResponse();
  if (typeof response === "string") return response;
  if (exception.message) return exception.message;
  return HttpStatus[statusCode] ?? "HTTP error";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function mapErrorCode(statusCode: number): StableHttpErrorCode {
  switch (statusCode) {
    case HttpStatus.BAD_REQUEST:
      return "VALIDATION_ERROR";
    case HttpStatus.UNAUTHORIZED:
      return "AUTHENTICATION_REQUIRED";
    case HttpStatus.FORBIDDEN:
      return "FORBIDDEN";
    case HttpStatus.NOT_FOUND:
      return "NOT_FOUND";
    case HttpStatus.CONFLICT:
      return "CONFLICT";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "RATE_LIMITED";
    default:
      return statusCode >= HttpStatus.INTERNAL_SERVER_ERROR ? "INTERNAL_ERROR" : "HTTP_ERROR";
  }
}
