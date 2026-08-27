import { createHmac, timingSafeEqual } from "node:crypto";
import {
  DEFAULT_JWT_AUDIENCE,
  DEFAULT_JWT_CLOCK_TOLERANCE_SECONDS,
  DEFAULT_JWT_ISSUER,
  DEFAULT_JWT_SESSION_TTL_SECONDS,
  type JwtSessionConfig,
} from "../config/security-config.js";
import type { SessionClaims, UserRole } from "./auth.types.js";

const TOKEN_HEADER = { alg: "HS256", typ: "JWT" } as const;
const ENCODED_HEADER = Buffer.from(JSON.stringify(TOKEN_HEADER)).toString("base64url");
const ROLES = new Set<UserRole>(["ADMIN", "OPERATOR", "VIEWER", "DEVELOPER"]);

export const DEFAULT_SESSION_TOKEN_CONFIG: JwtSessionConfig = {
  issuer: DEFAULT_JWT_ISSUER,
  audience: DEFAULT_JWT_AUDIENCE,
  ttlSeconds: DEFAULT_JWT_SESSION_TTL_SECONDS,
  clockToleranceSeconds: DEFAULT_JWT_CLOCK_TOLERANCE_SECONDS,
};

export function createSessionToken(
  input: { userId: number; role: UserRole; sessionVersion: number },
  secret: string,
  config: JwtSessionConfig = DEFAULT_SESSION_TOKEN_CONFIG,
): string {
  assertTokenInput(input, config);
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: SessionClaims = {
    sub: input.userId,
    role: input.role,
    sessionVersion: input.sessionVersion,
    iat: issuedAt,
    exp: issuedAt + config.ttlSeconds,
    iss: config.issuer,
    aud: config.audience,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const unsigned = `${ENCODED_HEADER}.${encodedPayload}`;
  return `${unsigned}.${sign(unsigned, secret)}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
  config: JwtSessionConfig = DEFAULT_SESSION_TOKEN_CONFIG,
): SessionClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  const [encodedHeader, encodedPayload, receivedSignature] = parts;
  if (!hasExpectedHeader(encodedHeader)) return null;

  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = sign(unsigned, secret);
  const received = Buffer.from(receivedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  try {
    const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<SessionClaims>;
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(claims.sub) || Number(claims.sub) <= 0) return null;
    if (!claims.role || !ROLES.has(claims.role)) return null;
    if (!Number.isSafeInteger(claims.sessionVersion) || Number(claims.sessionVersion) <= 0) return null;
    if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)) return null;
    if (Number(claims.exp) <= Number(claims.iat)) return null;
    if (Number(claims.exp) - Number(claims.iat) > config.ttlSeconds) return null;
    if (Number(claims.iat) > now + config.clockToleranceSeconds) return null;
    if (Number(claims.exp) <= now - config.clockToleranceSeconds) return null;
    if (claims.iss !== config.issuer || claims.aud !== config.audience) return null;
    return claims as SessionClaims;
  } catch {
    return null;
  }
}

function hasExpectedHeader(encodedHeader: string): boolean {
  try {
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as {
      alg?: unknown;
      typ?: unknown;
    };
    return header.alg === TOKEN_HEADER.alg && header.typ === TOKEN_HEADER.typ;
  } catch {
    return false;
  }
}

function assertTokenInput(
  input: { userId: number; role: UserRole; sessionVersion: number },
  config: JwtSessionConfig,
): void {
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0) throw new Error("Invalid session user ID.");
  if (!ROLES.has(input.role)) throw new Error("Invalid session role.");
  if (!Number.isSafeInteger(input.sessionVersion) || input.sessionVersion <= 0) {
    throw new Error("Invalid session version.");
  }
  if (!Number.isSafeInteger(config.ttlSeconds) || config.ttlSeconds <= 0) {
    throw new Error("Session TTL must be a positive integer.");
  }
  if (
    !Number.isSafeInteger(config.clockToleranceSeconds) ||
    config.clockToleranceSeconds < 0 ||
    config.clockToleranceSeconds > 300
  ) {
    throw new Error("Session clock tolerance must be an integer between 0 and 300.");
  }
  if (!config.issuer || !config.audience) throw new Error("Session issuer and audience are required.");
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}
