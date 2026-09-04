// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import { INITIAL_PRINTER_DIAGNOSTIC, usePrinterRuntime } from "./usePrinterRuntime";
import { DEFAULT_SYSTEM_PROFILE, useSystemProfile } from "./useSystemProfile";

const mocks = vi.hoisted(() => ({ fetchSystemProfile: vi.fn() }));

vi.mock("../../shared/api/developer-settings", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("../../shared/api/developer-settings")>();
  return { ...original, fetchSystemProfile: mocks.fetchSystemProfile };
});

const loadedProfile: DeveloperSettings = {
  schoolName: "한국대학교",
  academicYear: 2026,
  systemName: "가번호 관리 시스템",
  examineeNoUniqueness: "SYSTEM",
  pseudonymNoUniqueness: "ADMISSION",
  logoFileName: null,
  logoDataUrl: null,
  updatedAt: "2026-08-28T00:00:00.000Z",
};

describe("app shell runtime hooks", () => {
  beforeEach(() => {
    mocks.fetchSystemProfile.mockReset();
    window.localStorage.clear();
  });

  it("시스템 정보를 불러오고 실패 시에는 기본 브랜드를 유지한다", async () => {
    mocks.fetchSystemProfile.mockResolvedValueOnce(loadedProfile);
    const loaded = renderHook(() => useSystemProfile());
    await waitFor(() => expect(loaded.result.current.systemProfile).toEqual(loadedProfile));
    loaded.unmount();

    mocks.fetchSystemProfile.mockRejectedValueOnce(new Error("offline"));
    const fallback = renderHook(() => useSystemProfile());
    await waitFor(() => expect(mocks.fetchSystemProfile).toHaveBeenCalledTimes(2));
    expect(fallback.result.current.systemProfile).toEqual(DEFAULT_SYSTEM_PROFILE);
  });

  it("mock 프린터 진단과 인증 종료 시 초기화를 같은 런타임 경계에서 관리한다", async () => {
    const { result } = renderHook(() => usePrinterRuntime("mock"));
    expect(result.current.diagnostic).toEqual(INITIAL_PRINTER_DIAGNOSTIC);

    await act(async () => result.current.diagnose());
    expect(result.current.busy).toBe(false);
    expect(result.current.diagnostic).toMatchObject({ status: "READY", printer: { connection: "MOCK" } });
    expect(result.current.printers).toHaveLength(1);
    expect(result.current.selectedPrinterId).toBe("MOCK-GT800-001");

    act(() => result.current.resetDiagnostic());
    expect(result.current.diagnostic).toEqual(INITIAL_PRINTER_DIAGNOSTIC);
    expect(result.current.busy).toBe(false);
  });
});
