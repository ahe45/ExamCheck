import { describe, expect, it, vi } from "vitest";
import {
  createRequestContextMiddleware,
  getCurrentRequestId,
  isValidRequestId,
  MAX_REQUEST_ID_LENGTH,
  runWithRequestContext,
} from "./request-context.js";

describe("request context", () => {
  it("accepts only bounded, log-safe request ID characters", () => {
    expect(isValidRequestId("abc.DEF_123:-")).toBe(true);
    expect(isValidRequestId("")).toBe(false);
    expect(isValidRequestId("contains spaces")).toBe(false);
    expect(isValidRequestId("한글")).toBe(false);
    expect(isValidRequestId("x".repeat(MAX_REQUEST_ID_LENGTH))).toBe(true);
    expect(isValidRequestId("x".repeat(MAX_REQUEST_ID_LENGTH + 1))).toBe(false);
    expect(isValidRequestId(["one", "two"])).toBe(false);
  });

  it("serializes deterministic completion timing through an injected log writer", () => {
    const listener = vi.fn();
    const setHeader = vi.fn();
    const logWriter = vi.fn();
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(125);
    const middleware = createRequestContextMiddleware({ logWriter, now });
    const next = vi.fn();

    middleware(
      {
        headers: { "x-request-id": "request-1" },
        method: "post",
        originalUrl: "/api/v1/candidates/1162001?token=secret",
        route: { path: "/api/v1/candidates/:studentNo" },
      },
      {
        statusCode: 201,
        setHeader,
        once: (_event, callback) => listener.mockImplementation(callback),
      },
      next,
    );

    expect(setHeader).toHaveBeenCalledWith("x-request-id", "request-1");
    expect(next).toHaveBeenCalledOnce();
    listener();
    expect(logWriter).toHaveBeenCalledWith(
      JSON.stringify({
        method: "POST",
        path: "/api/v1/candidates/:studentNo",
        statusCode: 201,
        durationMs: 25,
        requestId: "request-1",
      }),
    );
    expect(logWriter.mock.calls[0]?.[0]).not.toContain("1162001");
    expect(logWriter.mock.calls[0]?.[0]).not.toContain("secret");
  });

  it("uses an unmatched marker instead of logging an unknown raw path", () => {
    const listener = vi.fn();
    const logWriter = vi.fn();
    const middleware = createRequestContextMiddleware({ logWriter });

    middleware(
      { headers: {}, method: "GET", originalUrl: "/unknown/1162001?name=private" },
      {
        statusCode: 404,
        setHeader: vi.fn(),
        once: (_event, callback) => listener.mockImplementation(callback),
      },
      vi.fn(),
    );
    listener();

    const serialized = logWriter.mock.calls[0]?.[0] as string;
    expect(JSON.parse(serialized)).toMatchObject({ path: "<unmatched>", statusCode: 404 });
    expect(serialized).not.toContain("1162001");
    expect(serialized).not.toContain("private");
  });

  it("propagates the request ID across asynchronous work without sharing it outside the request", async () => {
    expect(getCurrentRequestId()).toBeUndefined();
    await runWithRequestContext("request-async", async () => {
      await Promise.resolve();
      expect(getCurrentRequestId()).toBe("request-async");
    });
    expect(getCurrentRequestId()).toBeUndefined();
  });

  it("runs the downstream HTTP chain inside the request context", () => {
    const middleware = createRequestContextMiddleware();
    let downstreamRequestId: string | undefined;

    middleware(
      { headers: { "x-request-id": "request-downstream" } },
      { statusCode: 200, setHeader: vi.fn(), once: vi.fn() },
      () => {
        downstreamRequestId = getCurrentRequestId();
      },
    );

    expect(downstreamRequestId).toBe("request-downstream");
    expect(getCurrentRequestId()).toBeUndefined();
  });

  it("rejects unsafe request IDs when establishing an explicit context", () => {
    expect(() => runWithRequestContext("contains spaces", vi.fn())).toThrow("valid request ID");
  });
});
