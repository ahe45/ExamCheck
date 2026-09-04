// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CANDIDATE_PREVIEW_TOKEN_HEADER,
  fetchCandidateDashboardSummary,
  importCandidatePhotoArchive,
  importCandidateWorkbook,
  previewCandidatePhotoArchive,
  previewCandidateWorkbook,
} from "./candidates";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("candidate response contracts", () => {
  it("rejects a malformed dashboard aggregate through the safe response boundary", async () => {
    stubJsonResponse({
      totalCandidates: 1,
      assignedCandidates: 0,
      unassignedCandidates: 1,
      assignmentRate: 0,
      admissions: [],
      admissionCounts: { waiting: "1", progress: 0, complete: 0 },
      breakdowns: { admission: [], building: [], period: [], waitingRoom: [] },
    });

    await expect(fetchCandidateDashboardSummary("session-token")).rejects.toMatchObject({
      message: "서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      status: 502,
      code: "INVALID_RESPONSE",
    });
  });

  it("requires the signed ticket in both workbook and photo preview responses", async () => {
    stubJsonResponse({
      fileName: "candidates.xlsx",
      totalRows: 1,
      insertCount: 1,
      updateCount: 0,
      unchangedCount: 0,
    });
    await expect(previewCandidateWorkbook("session-token", file("candidates.xlsx"))).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });

    stubJsonResponse({
      fileName: "photos.zip",
      previewToken: "signed-photo-ticket",
      totalFiles: 1,
      matchedCount: 1,
      skippedCount: 0,
      duplicateCount: 0,
    });
    await expect(previewCandidatePhotoArchive("session-token", file("photos.zip"))).resolves.toMatchObject({
      previewToken: "signed-photo-ticket",
    });
  });

  it("keeps preview tickets out of URLs and sends them only through the dedicated header", async () => {
    const fetchMock = stubJsonResponse({ totalRows: 1, inserted: 1, updated: 0, skipped: 0 });

    await expect(
      importCandidateWorkbook("session-token", file("candidates.xlsx"), "insert-update", "signed-ticket"),
    ).resolves.toMatchObject({ inserted: 1 });

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = request.headers as Headers;
    expect(url).toContain("/candidates/import?policy=insert-update");
    expect(url).not.toContain("previewToken");
    expect(url).not.toContain("signed-ticket");
    expect(headers.get(CANDIDATE_PREVIEW_TOKEN_HEADER)).toBe("signed-ticket");
  });

  it("keeps photo preview tickets out of URLs and sends them only through the dedicated header", async () => {
    const fetchMock = stubJsonResponse({
      totalFiles: 1,
      uploaded: 1,
      updated: 0,
      skipped: 0,
      duplicateCount: 0,
    });

    await expect(
      importCandidatePhotoArchive("session-token", file("photos.zip"), "all", "signed-photo-ticket"),
    ).resolves.toMatchObject({ uploaded: 1 });

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = request.headers as Headers;
    expect(url).toContain("/candidates/photo-archive?policy=all");
    expect(url).not.toContain("previewToken");
    expect(url).not.toContain("signed-photo-ticket");
    expect(headers.get(CANDIDATE_PREVIEW_TOKEN_HEADER)).toBe("signed-photo-ticket");
  });

  it("validates the photo import result at runtime", async () => {
    stubJsonResponse({ totalFiles: 1, uploaded: "1", updated: 0, skipped: 0, duplicateCount: 0 });

    await expect(
      importCandidatePhotoArchive("session-token", file("photos.zip"), "all", "signed-photo-ticket"),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

function file(name: string) {
  return new File([Uint8Array.from([1, 2, 3])], name);
}

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
