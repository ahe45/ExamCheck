import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assignPseudonym,
  closePseudonymOperation,
  fetchPseudonymOperationStatus,
  fetchPseudonymSetting,
  fetchPseudonymSettingsOverview,
} from "./pseudonyms";

const operationScope = {
  examName: "2026년도 자격시험",
  examDate: "2026-08-28",
  examTime: "09:00",
  periodName: "1교시",
  admissionName: "학생부교과",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pseudonym response contracts", () => {
  it("rejects malformed settings overview data without exposing validation internals", async () => {
    stubJsonResponse([
      {
        name: "학생부교과",
        candidates: "30",
        dates: 1,
        schedules: 1,
        buildings: [],
        setting: null,
        error: false,
      },
    ]);

    const error = await fetchPseudonymSettingsOverview("session-token", operationScope.examName).catch(
      (reason: unknown) => reason,
    );
    expect(error).toMatchObject({
      message: "서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      status: 502,
      code: "INVALID_RESPONSE",
    });
    expect(String(error)).not.toContain("Zod");
    expect(String(error)).not.toContain("expected number");
  });

  it("validates operation status for both reads and close mutations", async () => {
    stubJsonResponse({
      closed: "false",
      closedAt: null,
      closedByLoginId: null,
      autoAssignedAbsenteeCount: 0,
    });
    await expect(fetchPseudonymOperationStatus("session-token", operationScope)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });

    stubJsonResponse({
      closed: true,
      closedAt: "2026-08-28T01:00:00.000Z",
      closedByLoginId: "operator",
      autoAssignedAbsenteeCount: 2,
    });
    await expect(closePseudonymOperation("session-token", operationScope)).resolves.toMatchObject({ closed: true });
  });

  it("validates setting and assignment responses used by the operation workflow", async () => {
    stubJsonResponse({ id: 1, version: "1" });
    await expect(fetchPseudonymSetting("session-token", "시험", "전형")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });

    stubJsonResponse({ id: 1, pseudonymNumber: "1001" });
    await expect(assignPseudonym("session-token", "10001", "MANUAL", operationScope, "1001")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});

function stubJsonResponse(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
