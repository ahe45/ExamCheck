import type { ServerResponse } from "node:http";

export const CONTENT_SECURITY_POLICY_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // Report-only deliberately permits the current Vite development runtime and
  // existing editor scripts while violations are measured before enforcement.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Browser Print connects to a local HTTP/WebSocket service. Keep all current
  // transports visible to the report-only policy until its exact ports are fixed.
  "connect-src 'self' http: https: ws: wss:",
  "worker-src 'self' blob:",
  "media-src 'self' data: blob:",
].join("; ");

export const HTTP_SECURITY_HEADERS = {
  "Content-Security-Policy-Report-Only": CONTENT_SECURITY_POLICY_REPORT_ONLY,
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

type HeaderResponse = Pick<ServerResponse, "setHeader">;

export function applySecurityHeaders(response: HeaderResponse) {
  for (const [name, value] of Object.entries(HTTP_SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
}

export function securityHeadersMiddleware(_request: unknown, response: HeaderResponse, next: () => void) {
  applySecurityHeaders(response);
  next();
}
