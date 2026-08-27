import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, apiBlob, apiFetch, subscribeToUnauthorized } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch error contract", () => {
  it("preserves the server error code and request id for support diagnostics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            statusCode: 409,
            message: "다른 사용자가 먼저 저장했습니다.",
            code: "CONFLICT",
            requestId: "request-from-body",
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json", "x-request-id": "request-from-header" },
          },
        ),
      ),
    );

    const error = await apiFetch("/test").catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: "다른 사용자가 먼저 저장했습니다.",
      status: 409,
      code: "CONFLICT",
      requestId: "request-from-body",
    });
  });

  it("joins validation messages and falls back to the response request-id header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: ["첫 번째 오류", "두 번째 오류"],
            code: "VALIDATION_ERROR",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json", "x-request-id": "request-from-header" },
          },
        ),
      ),
    );

    await expect(apiFetch("/test")).rejects.toMatchObject({
      message: "첫 번째 오류 두 번째 오류",
      status: 400,
      code: "VALIDATION_ERROR",
      requestId: "request-from-header",
    });
  });

  it("notifies the application once when an authenticated request receives 401", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToUnauthorized(listener);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: "로그인 정보가 만료되었습니다.",
            code: "UNAUTHORIZED",
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(apiFetch("/private", {}, "token")).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("does not notify session listeners for a public 401 such as a failed login", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToUnauthorized(listener);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(apiFetch("/auth/login")).rejects.toMatchObject({ status: 401 });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("adds bearer/json headers and returns blob response headers through one boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("file", {
        status: 200,
        headers: { "Content-Disposition": "attachment; filename=test.xlsx" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiBlob("/file", { method: "POST", body: JSON.stringify({ ok: true }) }, "token");

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = request.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer token");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(result.headers.get("Content-Disposition")).toContain("test.xlsx");
    expect(await result.blob.text()).toBe("file");
  });

  it("rejects a non-positive timeout before starting a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/test", { timeoutMs: 0 })).rejects.toThrow("API 요청 제한 시간은 양수여야 합니다.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps malformed JSON at a typed response boundary to one safe error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("not-json", {
          status: 200,
          headers: { "Content-Type": "application/json", "x-request-id": "invalid-json-request" },
        }),
      ),
    );

    await expect(apiFetch("/typed", {}, undefined, z.object({ ok: z.boolean() }))).rejects.toMatchObject({
      name: "ApiError",
      message: "서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      status: 502,
      code: "INVALID_RESPONSE",
      requestId: "invalid-json-request",
    });
  });

  it("rejects an invalid typed response shape without exposing schema internals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: "yes" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const error = await apiFetch("/typed", {}, undefined, z.object({ ok: z.boolean() })).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: "INVALID_RESPONSE" });
    expect(String(error)).not.toContain("Zod");
    expect(String(error)).not.toContain("expected boolean");
  });
});
