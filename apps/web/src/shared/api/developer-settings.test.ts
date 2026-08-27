import { afterEach, describe, expect, it, vi } from "vitest";
import { updateDeveloperSettings } from "./developer-settings";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("updateDeveloperSettings", () => {
  it("번호 유일 정책을 시스템 기본 정보와 함께 저장한다", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual({
        schoolName: "한국대학교",
        academicYear: 2026,
        systemName: "가번호 관리 시스템",
        examineeNoUniqueness: "SCHEDULE",
        pseudonymNoUniqueness: "ADMISSION",
      });
      return new Response(
        JSON.stringify({
          schoolName: "한국대학교",
          academicYear: 2026,
          systemName: "가번호 관리 시스템",
          examineeNoUniqueness: "SCHEDULE",
          pseudonymNoUniqueness: "ADMISSION",
          logoFileName: null,
          logoDataUrl: null,
          updatedAt: "2026-08-28T00:00:00.000Z",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await updateDeveloperSettings("developer-token", {
      schoolName: "한국대학교",
      academicYear: 2026,
      systemName: "가번호 관리 시스템",
      examineeNoUniqueness: "SCHEDULE",
      pseudonymNoUniqueness: "ADMISSION",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer developer-token");
  });
});
