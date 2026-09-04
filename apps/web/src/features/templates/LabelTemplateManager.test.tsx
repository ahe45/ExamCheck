// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrinterService } from "../printer/PrinterService";
import { defaultLabelLayout } from "./label-template-model";

const apiMock = vi.hoisted(() => ({
  templates: [] as Array<Record<string, unknown>>,
  deleteLabelTemplate: vi.fn(),
  fetchLabelTemplates: vi.fn(),
  previewLabelTemplate: vi.fn(),
  saveLabelTemplate: vi.fn(),
  updateLabelTemplateActive: vi.fn(),
}));

vi.mock("../../shared/api/label-templates", async (importOriginal) => ({
  ...(await importOriginal()),
  ...apiMock,
}));

import { LabelTemplateManager } from "./LabelTemplateManager";

const template = {
  id: 1,
  code: "PSEUDONYM_LABEL",
  name: "기본 가번호 라벨",
  description: "기본 출력 양식",
  zplTemplate: "^XA^XZ",
  layout: defaultLabelLayout,
  active: true,
  createdAt: "2026-09-03T00:00:00.000Z",
  createdByLoginId: "admin",
};

describe("LabelTemplateManager", () => {
  beforeEach(() => {
    apiMock.templates = [template];
    apiMock.fetchLabelTemplates.mockReset();
    apiMock.saveLabelTemplate.mockReset();
    apiMock.previewLabelTemplate.mockReset();
    apiMock.fetchLabelTemplates.mockImplementation(async () => ({
      templates: apiMock.templates,
      dataTags: {
        groups: [
          {
            key: "candidate",
            label: "수험생 정보",
            tags: [
              { key: "candidate.temporaryNo", label: "가번호", example: "1501" },
              { key: "candidate.examNo", label: "수험번호", example: "20260001" },
            ],
          },
        ],
      },
    }));
    apiMock.saveLabelTemplate.mockImplementation(async (_token, input) => {
      const saved = { ...template, ...input };
      apiMock.templates = [saved];
      return saved;
    });
    apiMock.previewLabelTemplate.mockResolvedValue({
      layout: defaultLabelLayout,
      zplTemplate: "^XA^FD1501^FS^XZ",
      samplePayload: "^XA^FD1501^FS^XZ",
    });
  });

  async function openEditor() {
    expect(await screen.findByRole("heading", { name: "라벨 양식 관리" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    expect(await screen.findByRole("heading", { name: "라벨 양식 편집" })).toBeVisible();
  }

  it("라벨 탭 진입 시 문서 양식과 같은 썸네일 카드 목록을 표시한다", async () => {
    render(<LabelTemplateManager token="token" />);

    expect(await screen.findByRole("heading", { name: "라벨 양식 관리" })).toBeVisible();
    expect(screen.getByText("기본 가번호 라벨")).toBeVisible();
    expect(screen.getByText("기본 출력 양식")).toBeVisible();
    expect(screen.getByText("총 1건")).toBeVisible();
    expect(screen.getByRole("button", { name: "수정" })).toBeVisible();
  });

  it("편집 내용을 버전 없이 현재 양식에 저장한다", async () => {
    const onDirtyChange = vi.fn();
    render(<LabelTemplateManager token="token" onDirtyChange={onDirtyChange} />);
    await openEditor();

    fireEvent.click(screen.getByRole("button", { name: "수험번호 · 20260001" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(apiMock.saveLabelTemplate).toHaveBeenCalledTimes(1));
    expect(apiMock.saveLabelTemplate.mock.calls[0]?.[1]).toMatchObject({
      code: "PSEUDONYM_LABEL",
      name: "기본 가번호 라벨",
      active: true,
    });
    expect(apiMock.saveLabelTemplate.mock.calls[0]?.[1]).not.toHaveProperty("version");
    expect(await screen.findByText("기본 가번호 라벨 라벨 양식을 저장했습니다.")).toBeVisible();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("편집기에서 문서 양식과 같은 데이터 태그 검색 UI를 제공한다", async () => {
    render(<LabelTemplateManager token="token" />);
    await openEditor();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "수험번호" } });
    expect(screen.getByRole("button", { name: "수험번호 · 20260001" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "가번호 · 1501" })).not.toBeInTheDocument();
  });

  it("현재 배치를 ZPL 미리보기로 생성한다", async () => {
    render(<LabelTemplateManager token="token" />);
    await openEditor();

    fireEvent.click(screen.getByRole("button", { name: "ZPL 미리보기 생성" }));
    expect(await screen.findByText("^XA^FD1501^FS^XZ")).toBeVisible();
  });

  it("저장된 진단 상태가 없어도 프린터를 다시 찾아 테스트 출력한다", async () => {
    const printer = { id: "printer-1", name: "Zebra GT800", connection: "USB" as const };
    const service = {
      discover: vi.fn().mockResolvedValue({
        printers: [printer],
        diagnostic: { status: "READY", printer, message: "사용 가능" },
      }),
      sendRaw: vi.fn().mockResolvedValue(undefined),
    } as unknown as PrinterService;
    render(<LabelTemplateManager token="token" service={service} />);
    await openEditor();

    fireEvent.click(screen.getByRole("button", { name: "테스트 출력" }));
    await waitFor(() => expect(service.sendRaw).toHaveBeenCalledWith(printer, "^XA^FD1501^FS^XZ"));
  });
});
