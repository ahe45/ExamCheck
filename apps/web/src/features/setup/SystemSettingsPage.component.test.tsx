/**
 * @vitest-environment jsdom
 */
import { act, createRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../shared/api/client";
import type { PseudonymSetting } from "../../shared/api/pseudonyms";
import { SystemSettingsPage, type SystemSettingsPageHandle } from "./SystemSettingsPage";

const candidateApi = vi.hoisted(() => ({ fetchCandidates: vi.fn() }));
const pseudonymApi = vi.hoisted(() => ({
  fetchPseudonymSetting: vi.fn(),
  updatePseudonymSetting: vi.fn(),
}));

vi.mock("../../shared/api/candidates", () => candidateApi);
vi.mock("../../shared/api/pseudonyms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/api/pseudonyms")>()),
  ...pseudonymApi,
}));

const setting: PseudonymSetting = {
  id: 11,
  version: 7,
  examName: "2026년도 자격시험",
  admissionName: "학생부교과 면접",
  rangeStart: 1001,
  rangeEnd: 1999,
  nextSequence: 1001,
  assignmentMethod: "MATCHING",
  autoDrawEnabled: false,
  autoDrawDelaySeconds: 3,
  printPreassignedLabel: false,
  autoAssignAbsenteesOnClose: false,
  deleteAbsenteeInfoOnReopen: false,
  useCandidatePhotos: true,
  enableBulkDraw: false,
  ranges: [],
};

beforeEach(() => {
  candidateApi.fetchCandidates.mockReset();
  pseudonymApi.fetchPseudonymSetting.mockReset();
  pseudonymApi.updatePseudonymSetting.mockReset();
  candidateApi.fetchCandidates.mockResolvedValue([]);
  pseudonymApi.fetchPseudonymSetting.mockResolvedValue({ ...setting });
});

describe("SystemSettingsPage optimistic save", () => {
  it("sends the loaded version and keeps edits after a concurrent-save conflict", async () => {
    pseudonymApi.updatePseudonymSetting.mockRejectedValue(
      new ApiError("다른 사용자가 이 전형의 설정을 먼저 변경했습니다.", 409),
    );
    const ref = createRef<SystemSettingsPageHandle>();

    render(<SystemSettingsPage ref={ref} token="admin-token" admissionName="학생부교과 면접" embedded />);

    const photoPolicy = await screen.findByRole("checkbox", { name: /수험생 사진 사용/ });
    fireEvent.click(photoPolicy);
    expect(photoPolicy).not.toBeChecked();

    let saved = true;
    await act(async () => {
      saved = (await ref.current?.save()) ?? true;
    });

    expect(saved).toBe(false);
    expect(pseudonymApi.updatePseudonymSetting).toHaveBeenCalledWith(
      "admin-token",
      expect.objectContaining({
        admissionName: "학생부교과 면접",
        expectedVersion: 7,
        useCandidatePhotos: false,
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("새로고침하여 최신 설정을 확인해 주세요.");
    await waitFor(() => expect(photoPolicy).not.toBeChecked());
  });

  it("keeps the range capacity fixed and opens the bulk dialog in same-start mode", async () => {
    candidateApi.fetchCandidates.mockResolvedValue([
      {
        date: "2026-08-11",
        time: "09:00",
        period: "1교시",
        admission: "학생부교과 면접",
        unit: "디자인학부",
        major: "기초디자인",
        building: "예술관",
        room: "101호",
      },
      {
        date: "2026-08-11",
        time: "09:00",
        period: "1교시",
        admission: "학생부교과 면접",
        unit: "디자인학부",
        major: "기초디자인",
        building: "예술관",
        room: "101호",
      },
    ]);
    pseudonymApi.fetchPseudonymSetting.mockResolvedValue({
      ...setting,
      assignmentMethod: "DRAW",
      ranges: [],
    });

    render(<SystemSettingsPage token="admin-token" admissionName="학생부교과 면접" embedded />);

    const startInput = await screen.findByRole("spinbutton", { name: /시작 번호/ });
    const endInput = screen.getByRole("spinbutton", { name: /종료 번호/ });
    expect(startInput).toHaveValue(1001);
    expect(endInput).toHaveValue(1002);

    fireEvent.change(startInput, { target: { value: "2501" } });
    expect(endInput).toHaveValue(2502);

    fireEvent.click(screen.getByRole("button", { name: /일괄 설정/ }));
    const bulkDialog = screen.getByRole("dialog", { name: "일괄 설정" });
    expect(bulkDialog).toBeInTheDocument();
    expect(within(bulkDialog).getByRole("spinbutton", { name: /가번호 시작 번호/ })).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("radio", { name: /동일 시작 번호 적용/ })).toBeChecked();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "일괄 설정" })).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe("");
  });
});
