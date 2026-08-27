import { describe, expect, it } from "vitest";
import { DEFAULT_FRONTEND_ORIGIN, resolveFrontendOrigins } from "./application-config.js";

describe("application configuration", () => {
  it("resolves comma-separated origins with whitespace, normalization, and deduplication", () => {
    expect(
      resolveFrontendOrigins({
        FRONTEND_ORIGINS: " http://localhost:5173/, https://admin.example.test, http://localhost:5173 ",
      }),
    ).toEqual(["http://localhost:5173", "https://admin.example.test"]);
  });

  it("keeps FRONTEND_ORIGIN as the fallback for existing deployments", () => {
    expect(resolveFrontendOrigins({ FRONTEND_ORIGIN: "https://legacy.example.test/" })).toEqual([
      "https://legacy.example.test",
    ]);
  });

  it("prefers the plural setting and retains the local development default", () => {
    expect(
      resolveFrontendOrigins({
        FRONTEND_ORIGINS: "https://primary.example.test",
        FRONTEND_ORIGIN: "https://legacy.example.test",
      }),
    ).toEqual(["https://primary.example.test"]);
    expect(resolveFrontendOrigins({})).toEqual([DEFAULT_FRONTEND_ORIGIN]);
  });

  it("rejects wildcard and non-origin values for credentialed CORS", () => {
    expect(() => resolveFrontendOrigins({ FRONTEND_ORIGINS: "*" })).toThrow("Wildcard FRONTEND_ORIGINS");
    expect(() => resolveFrontendOrigins({ FRONTEND_ORIGINS: "https://example.test/path" })).toThrow(
      "scheme, host, and port",
    );
    expect(() => resolveFrontendOrigins({ FRONTEND_ORIGINS: "not a URL" })).toThrow("Invalid frontend origin");
  });
});
