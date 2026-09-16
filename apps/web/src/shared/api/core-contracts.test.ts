import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCurrentUser, login } from "./auth";
import { ApiError } from "./client";
import { fetchSystemProfile } from "./developer-settings";
import { fetchOperationSchedules } from "./examinees";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("core API runtime contracts", () => {
  it("validates login and current-session users at the HTTP boundary", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "token", user: userResponse() }))
      .mockResolvedValueOnce(jsonResponse(userResponse()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(login("operator", "1234")).resolves.toEqual({ token: "token", user: userResponse() });
    await expect(fetchCurrentUser("token")).resolves.toEqual(userResponse());
  });

  it("rejects an invalid session role with the common safe response error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ...userResponse(), role: "ROOT" })));

    await expect(fetchCurrentUser("token")).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
      code: "INVALID_RESPONSE",
    } satisfies Partial<ApiError>);
  });

  it("validates the current allowed operation schedules", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          {
            date: "2026-10-30",
            time: "10:00",
            periodName: "오전",
            admissionName: "학생부교과",
            buildingNames: ["본관"],
            candidateCount: 30,
            assignedCount: 2,
            printedCount: 1,
            labelPrintingEnabled: true,
          },
        ]),
      ),
    );

    await expect(fetchOperationSchedules("token")).resolves.toMatchObject([
      { assignedCount: 2, printedCount: 1, labelPrintingEnabled: true },
    ]);
  });

  it("rejects malformed schedule counters instead of trusting a cast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          {
            date: "2026-10-30",
            time: "10:00",
            periodName: "오전",
            admissionName: "학생부교과",
            buildingNames: ["본관"],
            candidateCount: "30",
            assignedCount: 2,
            printedCount: 0,
            labelPrintingEnabled: false,
          },
        ]),
      ),
    );

    await expect(fetchOperationSchedules("token")).rejects.toMatchObject({
      status: 502,
      code: "INVALID_RESPONSE",
    });
  });

  it("validates the public system profile before rendering it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          schoolName: "한국대학교",
          academicYear: 2026,
          systemName: "가번호 관리 시스템",
          examineeNoUniqueness: "SYSTEM",
          pseudonymNoUniqueness: "ADMISSION",
          logoFileName: null,
          logoDataUrl: null,
          updatedAt: "2026-08-28T00:00:00.000Z",
        }),
      ),
    );

    await expect(fetchSystemProfile()).resolves.toMatchObject({ schoolName: "한국대학교", academicYear: 2026 });
  });
});

function userResponse() {
  return { id: 7, loginId: "operator", role: "OPERATOR" as const, admissionNames: ["학생부교과"] };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}
