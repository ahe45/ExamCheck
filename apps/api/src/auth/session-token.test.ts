import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JwtSessionConfig } from "../config/security-config.js";
import { createSessionToken, verifySessionToken } from "./session-token.js";

const SECRET = "session-token-test-secret";
const CONFIG: JwtSessionConfig = {
  issuer: "examcheck-test-api",
  audience: "examcheck-test-web",
  ttlSeconds: 3600,
  clockToleranceSeconds: 30,
};
const NOW_SECONDS = 2_000_000_000;

afterEach(() => {
  vi.useRealTimers();
});

describe("session tokens", () => {
  it("issues and verifies the complete bound session claims", () => {
    setNow(NOW_SECONDS);
    const token = createSessionToken({ userId: 7, role: "ADMIN", sessionVersion: 3 }, SECRET, CONFIG);

    expect(verifySessionToken(token, SECRET, CONFIG)).toEqual({
      sub: 7,
      role: "ADMIN",
      sessionVersion: 3,
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + 3600,
      iss: CONFIG.issuer,
      aud: CONFIG.audience,
    });
  });

  it("rejects signed tokens with an unexpected algorithm or type header", () => {
    setNow(NOW_SECONDS);
    const claims = validClaims();

    expect(verifySessionToken(signToken({ alg: "none", typ: "JWT" }, claims), SECRET, CONFIG)).toBeNull();
    expect(verifySessionToken(signToken({ alg: "HS256", typ: "JWS" }, claims), SECRET, CONFIG)).toBeNull();
  });

  it("rejects the wrong issuer, audience, missing session version, and overlong lifetime", () => {
    setNow(NOW_SECONDS);

    expect(verifySessionToken(signToken(undefined, { ...validClaims(), iss: "other" }), SECRET, CONFIG)).toBeNull();
    expect(verifySessionToken(signToken(undefined, { ...validClaims(), aud: "other" }), SECRET, CONFIG)).toBeNull();
    const { sessionVersion: _removed, ...withoutSessionVersion } = validClaims();
    expect(verifySessionToken(signToken(undefined, withoutSessionVersion), SECRET, CONFIG)).toBeNull();
    expect(
      verifySessionToken(
        signToken(undefined, { ...validClaims(), exp: NOW_SECONDS + CONFIG.ttlSeconds + 1 }),
        SECRET,
        CONFIG,
      ),
    ).toBeNull();
  });

  it("uses only the configured small tolerance for iat and expiration", () => {
    setNow(NOW_SECONDS);

    expect(
      verifySessionToken(
        signToken(undefined, {
          ...validClaims(),
          iat: NOW_SECONDS + CONFIG.clockToleranceSeconds,
          exp: NOW_SECONDS + CONFIG.clockToleranceSeconds + CONFIG.ttlSeconds,
        }),
        SECRET,
        CONFIG,
      ),
    ).not.toBeNull();
    expect(
      verifySessionToken(
        signToken(undefined, {
          ...validClaims(),
          iat: NOW_SECONDS + CONFIG.clockToleranceSeconds + 1,
          exp: NOW_SECONDS + CONFIG.clockToleranceSeconds + 1 + CONFIG.ttlSeconds,
        }),
        SECRET,
        CONFIG,
      ),
    ).toBeNull();
    expect(
      verifySessionToken(
        signToken(undefined, {
          ...validClaims(),
          iat: NOW_SECONDS - 3600,
          exp: NOW_SECONDS - CONFIG.clockToleranceSeconds + 1,
        }),
        SECRET,
        CONFIG,
      ),
    ).not.toBeNull();
    expect(
      verifySessionToken(
        signToken(undefined, {
          ...validClaims(),
          iat: NOW_SECONDS - 3600,
          exp: NOW_SECONDS - CONFIG.clockToleranceSeconds,
        }),
        SECRET,
        CONFIG,
      ),
    ).toBeNull();
  });
});

function validClaims() {
  return {
    sub: 7,
    role: "ADMIN",
    sessionVersion: 3,
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + CONFIG.ttlSeconds,
    iss: CONFIG.issuer,
    aud: CONFIG.audience,
  };
}

function signToken(header = { alg: "HS256", typ: "JWT" }, claims: object): string {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const unsigned = `${encodedHeader}.${encodedClaims}`;
  const signature = createHmac("sha256", SECRET).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

function setNow(seconds: number): void {
  vi.useFakeTimers();
  vi.setSystemTime(seconds * 1000);
}
