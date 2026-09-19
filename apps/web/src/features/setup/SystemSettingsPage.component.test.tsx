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
const labelTemplateApi = vi.hoisted(() => ({ fetchLabelTemplates: vi.fn() }));
const pseudonymApi = vi.hoisted(() => ({
  fetchPseudonymSetting: vi.fn(),
  updatePseudonymSetting: vi.fn(),
}));

vi.mock("../../shared/api/candidates", () => candidateApi);
vi.mock("../../shared/api/label-templates", () => labelTemplateApi);
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
  labelTemplateApi.fetchLabelTemplates.mockResolvedValue({ dataTags: { groups: [] }, templates: [] });
  pseudonymApi.fetchPseudonymSetting.mockResolvedValue({ ...setting });
});

describe("SystemSettingsPage optimistic save", () => {
  it("응시·결시 선택 표시 설정을 저장하고 다시 불러온 값을 유지한다", async () => {
    pseudonymApi.updatePseudonymSetting.mockResolvedValue({ ...setting, version: 8, showAttendanceSelection: false });
    const ref = createRef<SystemSettingsPageHandle>();
    const onDirtyChange = vi.fn();
    render(
      <SystemSettingsPage
        ref={ref}
        token="admin-token"
        admissionName="학생부교과 면접"
        embedded
        onDirtyChange={onDirtyChange}
      />,
    );
    const control = await screen.findByRole("checkbox", { name: /응시·결시 선택 표시/ });
    expect(control).toBeChecked();
    fireEvent.click(control);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await act(async () => {
      expect(await ref.current?.save()).toBe(true);
    });
    expect(pseudonymApi.updatePseudonymSetting).toHaveBeenCalledWith(
      "admin-token",
      expect.objectContaining({ showAttendanceSelection: false }),
    );
    expect(control).not.toBeChecked();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
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

    const startInput = await screen.findByRole("textbox", { name: /시작 번호/ });
    const endInput = screen.getByRole("textbox", { name: /종료 번호/ });
    expect(startInput).toHaveValue("1001");
    expect(endInput).toHaveValue("1002");

    fireEvent.change(startInput, { target: { value: "0001" } });
    expect(endInput).toHaveValue("0002");

    fireEvent.click(screen.getByRole("button", { name: /일괄 설정/ }));
    const bulkDialog = screen.getByRole("dialog", { name: "일괄 설정" });
    expect(bulkDialog).toBeInTheDocument();
    expect(within(bulkDialog).getByRole("textbox", { name: /가번호 시작 번호/ })).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("radio", { name: /동일 시작 번호 적용/ })).toBeChecked();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "일괄 설정" })).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe("");
  });

  it("전형별로 사용할 라벨 양식을 저장한다", async () => {
    pseudonymApi.fetchPseudonymSetting.mockResolvedValue({
      ...setting,
      assignmentMethod: "PREASSIGNED",
      printPreassignedLabel: true,
      labelTemplateId: null,
    });
    labelTemplateApi.fetchLabelTemplates.mockResolvedValue({
      dataTags: { groups: [] },
      templates: [
        {
          id: 21,
          code: "LABEL_A",
          name: "면접 전형 라벨",
          description: null,
          zplTemplate: "^XA^XZ",
          layout: { widthMm: 75, heightMm: 45, dpi: 203, elements: [] },
          active: true,
          createdAt: "2026-09-04T00:00:00.000Z",
          createdByLoginId: "admin",
        },
      ],
    });
    pseudonymApi.updatePseudonymSetting.mockImplementation(async (_token, input) => ({
      ...setting,
      ...input,
      id: 11,
      version: 8,
      nextSequence: 1001,
    }));
    const ref = createRef<SystemSettingsPageHandle>();
    render(<SystemSettingsPage ref={ref} token="admin-token" admissionName="학생부교과 면접" embedded />);

    fireEvent.change(await screen.findByRole("combobox", { name: "전형별 라벨 양식" }), {
      target: { value: "21" },
    });
    await act(async () => {
      await ref.current?.save();
    });

    expect(pseudonymApi.updatePseudonymSetting).toHaveBeenCalledWith(
      "admin-token",
      expect.objectContaining({ admissionName: "학생부교과 면접", labelTemplateId: 21 }),
    );
  });
});

it.each(["DRAW", "MATCHING"] as const)(
  "%s 방식에서 자동 생성된 범위를 표시하고 변경 없이 저장할 수 있다",
  async (assignmentMethod) => {
    const candidate = {
      date: "2026-10-30",
      time: "10:00",
      period: "오전",
      admission: "학생부교과 면접",
      unit: "유아교육과",
      major: "",
      building: "사범관",
      room: "면접고사실",
    };
    candidateApi.fetchCandidates.mockResolvedValue([candidate, candidate]);
    pseudonymApi.fetchPseudonymSetting.mockResolvedValue({ ...setting, version: 0, assignmentMethod });
    pseudonymApi.updatePseudonymSetting.mockImplementation(async (_token, input) => ({
      ...setting,
      ...input,
      version: 1,
    }));
    const ref = createRef<SystemSettingsPageHandle>();
    const onDirtyChange = vi.fn();
    const onSaveStateChange = vi.fn();
    render(
      <SystemSettingsPage
        ref={ref}
        token="admin-token"
        admissionName="학생부교과 면접"
        embedded
        onDirtyChange={onDirtyChange}
        onSaveStateChange={onSaveStateChange}
      />,
    );
    await waitFor(() => expect(onSaveStateChange).toHaveBeenLastCalledWith({ canSave: true, saving: false }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("heading", { name: "날짜·시간별 가번호 범위" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: /시작 번호/ })).toBeEnabled();
    await act(async () => {
      expect(await ref.current?.save()).toBe(true);
    });
    expect(pseudonymApi.updatePseudonymSetting).toHaveBeenCalledWith(
      "admin-token",
      expect.objectContaining({
        expectedVersion: 0,
        assignmentMethod,
        ranges: [expect.objectContaining({ ...candidate, rangeStart: 1001, rangeEnd: 1002 })],
      }),
    );
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  },
);
