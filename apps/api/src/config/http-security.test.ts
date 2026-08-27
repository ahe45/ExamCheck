import { describe, expect, it, vi } from "vitest";
import {
  CONTENT_SECURITY_POLICY_REPORT_ONLY,
  HTTP_SECURITY_HEADERS,
  applySecurityHeaders,
  securityHeadersMiddleware,
} from "./http-security.js";

describe("HTTP security headers", () => {
  it("applies the exact conservative report-only header set", () => {
    const setHeader = vi.fn();

    applySecurityHeaders({ setHeader });

    expect(Object.fromEntries(setHeader.mock.calls)).toEqual(HTTP_SECURITY_HEADERS);
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain("img-src 'self' data: blob:");
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain("connect-src 'self' http: https: ws: wss:");
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain("worker-src 'self' blob:");
  });

  it("continues the middleware chain after applying headers", () => {
    const setHeader = vi.fn();
    const next = vi.fn();

    securityHeadersMiddleware({}, { setHeader }, next);

    expect(setHeader).toHaveBeenCalledTimes(Object.keys(HTTP_SECURITY_HEADERS).length);
    expect(next).toHaveBeenCalledOnce();
  });
});
