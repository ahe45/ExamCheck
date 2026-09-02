import "reflect-metadata";
import { UnauthorizedException } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { Module } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountsController } from "../accounts/accounts.controller.js";
import { AccountsService } from "../accounts/accounts.service.js";
import { API_GLOBAL_PREFIX, configureApplication } from "../application-config.js";
import { AuthController } from "../auth/auth.controller.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthService } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { RolesGuard } from "../auth/roles.js";
import { createSessionToken } from "../auth/session-token.js";
import { APP_CONFIG, resolveAppConfig } from "../config/app-config.js";
import { CONTENT_SECURITY_POLICY_REPORT_ONLY, HTTP_SECURITY_HEADERS } from "../config/http-security.js";
import { DeveloperSettingsController } from "../developer-settings/developer-settings.controller.js";
import { DeveloperSettingsService } from "../developer-settings/developer-settings.service.js";

/**
 * Minimal transport/guard harness, not a full AppModule bootstrap test.
 * It reuses main.ts's prefix/CORS/ValidationPipe configurator and verifies the
 * transport/CORS boundary. DTO validation behavior is asserted by the separate
 * business HTTP boundary suite using the same production-style metadata transform.
 * Real password hashing and database access remain outside this deterministic suite.
 */
const TEST_SECRET = "http-e2e-secret-that-never-reaches-production";
const TEST_PASSWORD = "test-password";
const TEST_FRONTEND_ORIGIN = "http://localhost:5173";
const TEST_SECOND_FRONTEND_ORIGIN = "http://127.0.0.1:5173";
const TEST_DISALLOWED_ORIGIN = "https://untrusted.example.test";

const users = new Map<number, AuthenticatedUser>([
  [1, { id: 1, loginId: "admin", role: "ADMIN", admissionNames: [] }],
  [2, { id: 2, loginId: "가번호", role: "OPERATOR", admissionNames: ["학생부교과 면접"] }],
  [3, { id: 3, loginId: "dev", role: "DEVELOPER", admissionNames: [] }],
]);
const sessionVersions = new Map([...users.keys()].map((id) => [id, 1]));

let accountListCalls = 0;
let developerSettingsGetCalls = 0;

const authServiceStub = {
  async login(loginId: string, password: string) {
    const user = [...users.values()].find((candidate) => candidate.loginId === loginId.trim());
    if (!user || password !== TEST_PASSWORD)
      throw new UnauthorizedException("아이디 또는 비밀번호가 올바르지 않습니다.");
    return {
      token: createSessionToken(
        { userId: user.id, role: user.role, sessionVersion: sessionVersions.get(user.id) ?? 1 },
        TEST_SECRET,
      ),
      user,
    };
  },
  async findEnabledSessionUserById(id: number) {
    const user = users.get(id);
    return user ? { user, sessionVersion: sessionVersions.get(id) ?? 1 } : null;
  },
};

const accountsServiceStub = {
  async list() {
    accountListCalls += 1;
    return [{ id: 10, loginId: "managed-user", role: "USER", admissionNames: [] }];
  },
  async admissions() {
    return ["학생부교과 면접"];
  },
  async create() {
    return { id: 11, loginId: "created-user", role: "USER", admissionNames: [] };
  },
  async update() {
    return { id: 10, loginId: "updated-user", role: "USER", admissionNames: [] };
  },
  async remove(id: number) {
    return { id, deleted: true };
  },
};

const developerSettingsServiceStub = {
  async getForUser() {
    developerSettingsGetCalls += 1;
    return {
      schoolName: "한국대학교",
      academicYear: 2026,
      systemName: "가번호 관리 시스템",
      logoUrl: null,
      examineeNoUniqueness: "SYSTEM",
      pseudonymNoUniqueness: "ADMISSION",
      updatedAt: null,
    };
  },
};

@Module({
  controllers: [AuthController, AccountsController, DeveloperSettingsController],
  providers: [
    Reflector,
    AuthGuard,
    RolesGuard,
    {
      provide: APP_CONFIG,
      useValue: resolveAppConfig({ NODE_ENV: "test", JWT_SECRET: TEST_SECRET }),
    },
    { provide: AuthService, useValue: authServiceStub },
    { provide: AccountsService, useValue: accountsServiceStub },
    { provide: DeveloperSettingsService, useValue: developerSettingsServiceStub },
  ],
})
class AuthAccountsHttpE2eModule {}

describe("AuthController and AccountsController HTTP boundaries", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AuthAccountsHttpE2eModule, { logger: false });
    configureApplication(app, {
      frontendOrigins: [TEST_FRONTEND_ORIGIN, TEST_SECOND_FRONTEND_ORIGIN],
      requestLogWriter: () => undefined,
    });
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as AddressInfo | string | null;
    if (!address || typeof address === "string") throw new Error("HTTP E2E server did not bind to a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}/${API_GLOBAL_PREFIX}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("serves login through the real HTTP controller", async () => {
    const response = await postJson("/auth/login", { loginId: "admin", password: TEST_PASSWORD });
    const body = (await response.json()) as { token: string; user: AuthenticatedUser };

    expect(response.status).toBe(201);
    expect(body.token.split(".")).toHaveLength(3);
    expect(body.user).toEqual(users.get(1));

    const rejected = await postJson("/auth/login", { loginId: "admin", password: "wrong-password" });
    expect(rejected.status).toBe(401);
  });

  it("uses the production application configurator for prefix and credentialed CORS", async () => {
    const response = await fetch(`${baseUrl}/auth/me`, { headers: { Origin: TEST_FRONTEND_ORIGIN } });

    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe(TEST_FRONTEND_ORIGIN);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("allows every configured browser origin", async () => {
    const response = await fetch(`${baseUrl}/auth/me`, {
      headers: { Origin: TEST_SECOND_FRONTEND_ORIGIN },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe(TEST_SECOND_FRONTEND_ORIGIN);
  });

  it("allows server-to-server requests without Origin and withholds CORS from untrusted origins", async () => {
    const serverRequest = await fetch(`${baseUrl}/auth/me`);
    const untrustedBrowserRequest = await fetch(`${baseUrl}/auth/me`, {
      headers: { Origin: TEST_DISALLOWED_ORIGIN },
    });

    expect(serverRequest.status).toBe(401);
    expect(serverRequest.headers.get("access-control-allow-origin")).toBeNull();
    expect(untrustedBrowserRequest.status).toBe(401);
    expect(untrustedBrowserRequest.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("emits the exact report-only and conservative security headers over HTTP", async () => {
    const response = await fetch(`${baseUrl}/auth/me`);

    expect(response.headers.get("content-security-policy-report-only")).toBe(CONTENT_SECURITY_POLICY_REPORT_ONLY);
    expect(response.headers.get("referrer-policy")).toBe(HTTP_SECURITY_HEADERS["Referrer-Policy"]);
    expect(response.headers.get("x-content-type-options")).toBe(HTTP_SECURITY_HEADERS["X-Content-Type-Options"]);
    expect(response.headers.get("x-frame-options")).toBe(HTTP_SECURITY_HEADERS["X-Frame-Options"]);
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("rejects protected routes when authentication is missing", async () => {
    const callsBefore = accountListCalls;
    const me = await fetch(`${baseUrl}/auth/me`);
    const accounts = await fetch(`${baseUrl}/accounts`);

    expect(me.status).toBe(401);
    expect(accounts.status).toBe(401);
    expect(accountListCalls).toBe(callsBefore);
  });

  it("accepts an authenticated OPERATOR at auth/me but denies the ADMIN-only accounts boundary", async () => {
    const token = await loginAs("가번호");
    const me = await fetch(`${baseUrl}/auth/me`, { headers: bearer(token) });
    const callsBefore = accountListCalls;
    const accounts = await fetch(`${baseUrl}/accounts`, { headers: bearer(token) });

    expect(me.status).toBe(200);
    expect(await me.json()).toEqual(users.get(2));
    expect(accounts.status).toBe(403);
    expect(accountListCalls).toBe(callsBefore);
  });

  it("allows ADMIN to reach the accounts controller", async () => {
    const token = await loginAs("admin");
    const callsBefore = accountListCalls;
    const response = await fetch(`${baseUrl}/accounts`, { headers: bearer(token) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: 10, loginId: "managed-user", role: "USER", admissionNames: [] }]);
    expect(accountListCalls).toBe(callsBefore + 1);
  });

  it("treats DEVELOPER as the authenticated superuser at an ADMIN-only boundary", async () => {
    const token = await loginAs("dev");
    const callsBefore = accountListCalls;
    const response = await fetch(`${baseUrl}/accounts`, { headers: bearer(token) });

    expect(response.status).toBe(200);
    expect(accountListCalls).toBe(callsBefore + 1);
  });

  it("keeps uniqueness policy settings behind the developer-only HTTP boundary", async () => {
    const administratorToken = await loginAs("admin");
    const callsBeforeAdministrator = developerSettingsGetCalls;
    const denied = await fetch(`${baseUrl}/developer-settings`, { headers: bearer(administratorToken) });

    expect(denied.status).toBe(403);
    expect(developerSettingsGetCalls).toBe(callsBeforeAdministrator);

    const developerToken = await loginAs("dev");
    const allowed = await fetch(`${baseUrl}/developer-settings`, { headers: bearer(developerToken) });

    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({
      examineeNoUniqueness: "SYSTEM",
      pseudonymNoUniqueness: "ADMISSION",
    });
    expect(developerSettingsGetCalls).toBe(callsBeforeAdministrator + 1);
  });

  it("rejects a token when its role claim no longer matches the enabled user", async () => {
    const mismatchedToken = createSessionToken({ userId: 2, role: "ADMIN", sessionVersion: 1 }, TEST_SECRET);
    const response = await fetch(`${baseUrl}/auth/me`, { headers: bearer(mismatchedToken) });

    expect(response.status).toBe(401);
  });

  it("rejects a token when its session version no longer matches the database", async () => {
    const token = createSessionToken({ userId: 2, role: "OPERATOR", sessionVersion: 1 }, TEST_SECRET);
    sessionVersions.set(2, 2);
    try {
      const response = await fetch(`${baseUrl}/auth/me`, { headers: bearer(token) });
      expect(response.status).toBe(401);
    } finally {
      sessionVersions.set(2, 1);
    }
  });

  function postJson(path: string, body: unknown) {
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function loginAs(loginId: string) {
    const response = await postJson("/auth/login", { loginId, password: TEST_PASSWORD });
    expect(response.status).toBe(201);
    return ((await response.json()) as { token: string }).token;
  }

  function bearer(token: string) {
    return { Authorization: `Bearer ${token}` };
  }
});
