import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { API_GLOBAL_PREFIX, configureApplication } from "../application-config.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthService } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { RolesGuard } from "../auth/roles.js";
import { createSessionToken } from "../auth/session-token.js";
import { CANDIDATE_PREVIEW_TOKEN_HEADER, CandidatesController } from "../candidates/candidates.controller.js";
import { CandidatesService } from "../candidates/candidates.service.js";
import { REQUEST_ID_HEADER } from "../common/http/http-boundary.js";
import { APP_CONFIG, resolveAppConfig } from "../config/app-config.js";
import { FormTemplatesController } from "../form-templates/form-templates.controller.js";
import { FormTemplatesService } from "../form-templates/form-templates.service.js";
import { PrintJobsController } from "../print-jobs/print-jobs.controller.js";
import { PrintJobsService } from "../print-jobs/print-jobs.service.js";
import { PseudonymsController } from "../pseudonyms/pseudonyms.controller.js";
import { PseudonymsService } from "../pseudonyms/pseudonyms.service.js";

const TEST_SECRET = "business-http-e2e-secret-that-never-reaches-production";
const users = new Map<number, AuthenticatedUser>([
  [1, { id: 1, loginId: "admin", role: "ADMIN", admissionNames: [] }],
  [2, { id: 2, loginId: "operator", role: "OPERATOR", admissionNames: ["일반"] }],
  [3, { id: 3, loginId: "viewer", role: "VIEWER", admissionNames: ["일반"] }],
]);

const authServiceStub = {
  findEnabledSessionUserById: vi.fn(async (id: number) => {
    const user = users.get(id);
    return user ? { user, sessionVersion: 1 } : null;
  }),
};
const candidateImport = vi.fn(async () => ({ totalRows: 1, inserted: 1, updated: 0, skipped: 0 }));
const candidateDashboardSummary = vi.fn(async () => ({ totalCandidates: 0, admissions: [] }));
const pseudonymAssign = vi.fn(async () => ({ id: 11, pseudonymNumber: "1001" }));
const pseudonymSettingUpdate = vi.fn(async () => ({ id: 9, version: 2 }));
const pseudonymSettingsOverview = vi.fn(async () => []);
const templateFindActive = vi.fn(async () => ({ code: "ROOM_LIST" }));
const templateSave = vi.fn(async () => ({ id: 21, code: "ROOM_LIST" }));
const templateUpdateActive = vi.fn(async () => ({ id: 21, code: "ROOM_LIST", active: false }));
const printJobCreate = vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111", status: "READY" }));
const printJobReissue = vi.fn(async () => ({ id: "22222222-2222-4222-8222-222222222222", status: "READY" }));

const candidatesServiceStub = { dashboardSummary: candidateDashboardSummary, import: candidateImport };
const pseudonymsServiceStub = {
  assign: pseudonymAssign,
  getSettingsOverview: pseudonymSettingsOverview,
  updateSetting: pseudonymSettingUpdate,
};
const formTemplatesServiceStub = {
  findActive: templateFindActive,
  save: templateSave,
  updateActive: templateUpdateActive,
};
const printJobsServiceStub = { create: printJobCreate, reissue: printJobReissue };

@Module({
  controllers: [CandidatesController, PseudonymsController, FormTemplatesController, PrintJobsController],
  providers: [
    Reflector,
    AuthGuard,
    RolesGuard,
    { provide: APP_CONFIG, useValue: resolveAppConfig({ NODE_ENV: "test", JWT_SECRET: TEST_SECRET }) },
    { provide: AuthService, useValue: authServiceStub },
    { provide: CandidatesService, useValue: candidatesServiceStub },
    { provide: PseudonymsService, useValue: pseudonymsServiceStub },
    { provide: FormTemplatesService, useValue: formTemplatesServiceStub },
    { provide: PrintJobsService, useValue: printJobsServiceStub },
  ],
})
class BusinessHttpE2eModule {}

describe("business controller HTTP boundaries", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(BusinessHttpE2eModule, { logger: false });
    configureApplication(app, {
      frontendOrigin: "http://localhost:5173",
      requestLogWriter: () => undefined,
    });
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as AddressInfo | string | null;
    if (!address || typeof address === "string") throw new Error("Business HTTP E2E server did not bind.");
    baseUrl = `http://127.0.0.1:${address.port}/${API_GLOBAL_PREFIX}`;
  });

  beforeEach(() => {
    candidateImport.mockClear();
    candidateDashboardSummary.mockClear();
    pseudonymAssign.mockClear();
    pseudonymSettingsOverview.mockClear();
    pseudonymSettingUpdate.mockClear();
    templateFindActive.mockClear();
    templateSave.mockClear();
    templateUpdateActive.mockClear();
    printJobCreate.mockClear();
    printJobReissue.mockClear();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("rejects an unauthenticated business mutation with the common 401 envelope", async () => {
    const response = await jsonRequest("/pseudonyms/assignments", "POST", assignmentInput());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(body).toMatchObject({
      statusCode: 401,
      code: "AUTHENTICATION_REQUIRED",
      path: `/${API_GLOBAL_PREFIX}/pseudonyms/assignments`,
    });
    expect(pseudonymAssign).not.toHaveBeenCalled();
  });

  it("allows an operator to assign a pseudonym, create a print job and request a safe-code retry", async () => {
    const operator = requireUser(2);
    const token = tokenFor(operator);
    const assignment = await jsonRequest("/pseudonyms/assignments", "POST", assignmentInput(), token);
    const printJob = await jsonRequest("/print-jobs", "POST", printJobInput(), token);
    const reissueInput = {
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      reasonCode: "CLIENT_SEND_RETRY",
    };
    const reissue = await jsonRequest(
      "/print-jobs/11111111-1111-4111-8111-111111111111/reissue",
      "POST",
      reissueInput,
      token,
    );

    expect(assignment.status).toBe(201);
    expect(printJob.status).toBe(201);
    expect(reissue.status).toBe(201);
    expect(pseudonymAssign).toHaveBeenCalledWith(expect.objectContaining(assignmentInput()), operator);
    expect(printJobCreate).toHaveBeenCalledWith(expect.objectContaining(printJobInput()), operator);
    expect(printJobReissue).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining(reissueInput),
      operator,
    );
  });

  it("allows an administrator to update settings, save a template and import candidates", async () => {
    const administrator = requireUser(1);
    const token = tokenFor(administrator);
    const setting = await jsonRequest("/pseudonyms/setting", "PUT", settingInput(), token);
    const template = await jsonRequest("/form-templates/ROOM_LIST", "PUT", templateInput(), token);
    const templateAvailability = await jsonRequest(
      "/form-templates/ROOM_LIST/active",
      "PATCH",
      { active: false },
      token,
    );
    const candidates = await multipartImport("all", token);

    expect(setting.status).toBe(200);
    expect(template.status).toBe(200);
    expect(templateAvailability.status).toBe(200);
    expect(candidates.status).toBe(201);
    expect(pseudonymSettingUpdate).toHaveBeenCalledWith(expect.objectContaining(settingInput()), administrator);
    expect(templateSave).toHaveBeenCalledWith(expect.objectContaining(templateInput()), administrator);
    expect(templateUpdateActive).toHaveBeenCalledWith("ROOM_LIST", { active: false }, administrator);
    expect(candidateImport).toHaveBeenCalledWith(expect.any(Buffer), "all", "signed-preview-ticket", administrator.id);
  });

  it("allows the dedicated preview-ticket header through browser CORS preflight", async () => {
    const response = await fetch(`${baseUrl}/candidates/import`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": `authorization,${CANDIDATE_PREVIEW_TOKEN_HEADER}`,
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
      CANDIDATE_PREVIEW_TOKEN_HEADER,
    );
  });

  it("rejects the legacy previewToken query even when it contains a ticket", async () => {
    const administratorToken = tokenFor(requireUser(1));
    const requestId = "legacy-query-preview-token";
    const query = new URLSearchParams({ policy: "all", previewToken: "legacy-query-ticket" });
    const response = await fetch(`${baseUrl}/candidates/import?${query.toString()}`, {
      method: "POST",
      headers: authenticatedHeaders(administratorToken, requestId),
      body: candidateWorkbookForm(),
    });

    await expectValidationEnvelope(response, "/candidates/import", requestId, "property previewToken should not exist");
    expect(candidateImport).not.toHaveBeenCalled();
  });

  it("serves the dashboard aggregate and settings overview through authenticated read boundaries", async () => {
    const administrator = requireUser(1);
    const token = tokenFor(administrator);
    const dashboard = await getRequest("/candidates/dashboard-summary", token);
    const overview = await getRequest(
      `/pseudonyms/settings-overview?examName=${encodeURIComponent("2026년도 자격시험")}`,
      token,
    );

    expect(dashboard.status).toBe(200);
    expect(overview.status).toBe(200);
    expect(candidateDashboardSummary).toHaveBeenCalledWith(administrator, undefined);
    expect(pseudonymSettingsOverview).toHaveBeenCalledWith("2026년도 자격시험", administrator);
  });

  it("returns 403 before calling services for permissions outside the authenticated role", async () => {
    const operatorToken = tokenFor(requireUser(2));
    const viewerToken = tokenFor(requireUser(3));

    const operatorSetting = await jsonRequest("/pseudonyms/setting", "PUT", settingInput(), operatorToken);
    const operatorTemplate = await jsonRequest("/form-templates/ROOM_LIST", "PUT", templateInput(), operatorToken);
    const operatorTemplateAvailability = await jsonRequest(
      "/form-templates/ROOM_LIST/active",
      "PATCH",
      { active: false },
      operatorToken,
    );
    const operatorImport = await multipartImport("all", operatorToken);
    const viewerAssignment = await jsonRequest("/pseudonyms/assignments", "POST", assignmentInput(), viewerToken);
    const viewerPrint = await jsonRequest("/print-jobs", "POST", printJobInput(), viewerToken);

    for (const response of [
      operatorSetting,
      operatorTemplate,
      operatorTemplateAvailability,
      operatorImport,
      viewerAssignment,
      viewerPrint,
    ]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    }
    expect(pseudonymSettingUpdate).not.toHaveBeenCalled();
    expect(templateSave).not.toHaveBeenCalled();
    expect(templateUpdateActive).not.toHaveBeenCalled();
    expect(candidateImport).not.toHaveBeenCalled();
    expect(pseudonymAssign).not.toHaveBeenCalled();
    expect(printJobCreate).not.toHaveBeenCalled();
  });

  it("uses real path, query and body DTO metadata with the common validation envelope", async () => {
    const administratorToken = tokenFor(requireUser(1));
    const operatorToken = tokenFor(requireUser(2));
    const invalidPath = await fetch(`${baseUrl}/form-templates/lower-case`, {
      headers: authenticatedHeaders(administratorToken, "invalid-path"),
    });
    const invalidQuery = await multipartImport("overwrite", administratorToken, "invalid-query");
    const missingPreview = await multipartImport("all", administratorToken, "missing-preview", false);
    const oversizedPreview = await multipartImport("all", administratorToken, "oversized-preview", "x".repeat(2049));
    const invalidBody = await jsonRequest(
      "/pseudonyms/assignments",
      "POST",
      { ...assignmentInput(), mode: "INVALID" },
      operatorToken,
      "invalid-body",
    );
    const invalidReissue = await jsonRequest(
      "/print-jobs/11111111-1111-4111-8111-111111111111/reissue",
      "POST",
      { idempotencyKey: "22222222-2222-4222-8222-222222222222", reasonCode: "contains candidate name" },
      operatorToken,
      "invalid-reissue",
    );

    await expectValidationEnvelope(invalidPath, "/form-templates/lower-case", "invalid-path", "code must match");
    await expectValidationEnvelope(invalidQuery, "/candidates/import", "invalid-query", "policy must be one of");
    await expectValidationEnvelope(
      missingPreview,
      "/candidates/import",
      "missing-preview",
      "수험생 데이터 미리보기 토큰을 확인해 주세요.",
    );
    await expectValidationEnvelope(
      oversizedPreview,
      "/candidates/import",
      "oversized-preview",
      "수험생 데이터 미리보기 토큰을 확인해 주세요.",
    );
    await expectValidationEnvelope(invalidBody, "/pseudonyms/assignments", "invalid-body", "mode must be one of");
    await expectValidationEnvelope(
      invalidReissue,
      "/print-jobs/11111111-1111-4111-8111-111111111111/reissue",
      "invalid-reissue",
      "reasonCode must be one of",
    );
    expect(templateFindActive).not.toHaveBeenCalled();
    expect(candidateImport).not.toHaveBeenCalled();
    expect(pseudonymAssign).not.toHaveBeenCalled();
    expect(printJobReissue).not.toHaveBeenCalled();
  });

  it("rejects malformed aggregate read query DTOs before calling services", async () => {
    const token = tokenFor(requireUser(1));
    const dashboard = await getRequest(
      `/candidates/dashboard-summary?admissionName=${encodeURIComponent("x".repeat(201))}`,
      token,
      "invalid-dashboard-query",
    );
    const overview = await getRequest(
      "/pseudonyms/settings-overview?examName=%20%20%20",
      token,
      "invalid-overview-query",
    );

    await expectValidationEnvelope(
      dashboard,
      "/candidates/dashboard-summary",
      "invalid-dashboard-query",
      "admissionName must be shorter than or equal to 200 characters",
    );
    await expectValidationEnvelope(
      overview,
      "/pseudonyms/settings-overview",
      "invalid-overview-query",
      "examName must match",
    );
    expect(candidateDashboardSummary).not.toHaveBeenCalled();
    expect(pseudonymSettingsOverview).not.toHaveBeenCalled();
  });

  function getRequest(path: string, token: string, requestId?: string) {
    return fetch(`${baseUrl}${path}`, { headers: authenticatedHeaders(token, requestId) });
  }

  function jsonRequest(
    path: string,
    method: "PATCH" | "POST" | "PUT",
    body: unknown,
    token?: string,
    requestId?: string,
  ) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (requestId) headers[REQUEST_ID_HEADER] = requestId;
    return fetch(`${baseUrl}${path}`, { method, headers, body: JSON.stringify(body) });
  }

  function multipartImport(
    policy: string,
    token: string,
    requestId?: string,
    previewToken: string | false = "signed-preview-ticket",
  ) {
    const query = new URLSearchParams({ policy });
    return fetch(`${baseUrl}/candidates/import?${query.toString()}`, {
      method: "POST",
      headers: {
        ...authenticatedHeaders(token, requestId),
        ...(previewToken ? { [CANDIDATE_PREVIEW_TOKEN_HEADER]: previewToken } : {}),
      },
      body: candidateWorkbookForm(),
    });
  }

  function candidateWorkbookForm() {
    const form = new FormData();
    form.append(
      "file",
      new Blob([Uint8Array.from([0x50, 0x4b, 0x03, 0x04])], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "candidates.xlsx",
    );
    return form;
  }

  function authenticatedHeaders(token: string, requestId?: string) {
    return {
      Authorization: `Bearer ${token}`,
      ...(requestId ? { [REQUEST_ID_HEADER]: requestId } : {}),
    };
  }

  async function expectValidationEnvelope(
    response: Response,
    path: string,
    requestId: string,
    messageFragment: string,
  ) {
    const body = (await response.json()) as Record<string, unknown>;
    const messages = Array.isArray(body.message) ? body.message.join(" ") : String(body.message);
    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      path: `/${API_GLOBAL_PREFIX}${path}`,
      requestId,
    });
    expect(body.timestamp).toEqual(expect.any(String));
    expect(messages).toContain(messageFragment);
  }
});

function tokenFor(user: AuthenticatedUser) {
  return createSessionToken({ userId: user.id, role: user.role, sessionVersion: 1 }, TEST_SECRET);
}

function requireUser(id: number) {
  const user = users.get(id);
  if (!user) throw new Error(`Missing HTTP E2E user: ${id}`);
  return user;
}

function assignmentInput() {
  return {
    examineeNo: "10001",
    mode: "MANUAL" as const,
    manualNumber: "1001",
    examDate: "2026-08-11",
    examTime: "09:00",
    periodName: "1교시",
    admissionName: "일반",
  };
}

function printJobInput() {
  return {
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    examineeNo: "10001",
    workstationCode: "WS-1",
    copies: 1,
    examDate: "2026-08-11",
    examTime: "09:00",
    periodName: "1교시",
    admissionName: "일반",
  };
}

function settingInput() {
  return {
    expectedVersion: 1,
    examName: "2026 실기",
    admissionName: "일반",
    rangeStart: 1,
    rangeEnd: 9999,
    assignmentMethod: "MATCHING" as const,
    autoDrawEnabled: false,
    autoDrawDelaySeconds: 3,
    printPreassignedLabel: false,
    autoAssignAbsenteesOnClose: false,
    deleteAbsenteeInfoOnReopen: false,
    useCandidatePhotos: true,
    enableBulkDraw: false,
    ranges: [],
  };
}

function templateInput() {
  return {
    code: "ROOM_LIST",
    name: "고사실 명단",
    description: "테스트 양식",
    category: "명단",
    usageScope: "ROOM" as const,
    layout: { pages: [] },
    active: true,
  };
}
