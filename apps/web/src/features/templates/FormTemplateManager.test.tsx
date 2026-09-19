// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormTemplateSummary } from "../../shared/api/form-templates";
import { createBlankDraft, type DraftTemplate } from "./template-manager-model";

const apiMock = vi.hoisted(() => ({
  fetchAdminFormTemplates: vi.fn(async (): Promise<FormTemplateSummary[]> => []),
  fetchFormTemplate: vi.fn(),
  fetchFormTemplateDataTags: vi.fn(async () => ({ tags: [] })),
  saveFormTemplate: vi.fn(),
  updateFormTemplateActive: vi.fn(),
  updateFormTemplateMetadata: vi.fn(),
}));

const lazyEntryMock = vi.hoisted(() => ({ loaded: vi.fn(), render: vi.fn() }));

vi.mock("../../shared/api/form-templates", () => apiMock);

vi.mock("./TemplateEditorWorkspaceLazy", async () => {
  lazyEntryMock.loaded();
  const React = await import("react");
  return {
    default: React.forwardRef((props: { draft: DraftTemplate }, _ref) => {
      lazyEntryMock.render(props);
      return React.createElement("div", null, "지연 로드된 양식 편집기");
    }),
  };
});

import { FormTemplateManager } from "./FormTemplateManager";
import { FORM_EDITOR_SESSION_KEY as formTemplateEditorSessionStorageKey } from "../../shared/session/template-session";

describe("FormTemplateManager lazy editor boundary", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    apiMock.fetchAdminFormTemplates.mockReset().mockResolvedValue([]);
    apiMock.fetchFormTemplate.mockReset();
    apiMock.fetchFormTemplateDataTags.mockClear();
    lazyEntryMock.loaded.mockClear();
    lazyEntryMock.render.mockClear();
  });

  it("양식 목록에서는 편집기를 불러오지 않고 편집 진입 시에만 불러온다", async () => {
    render(<FormTemplateManager token="token" />);

    expect(await screen.findByRole("heading", { name: "양식 관리" })).toBeVisible();
    expect(lazyEntryMock.loaded).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "첫 양식 만들기" }));

    expect(await screen.findByText("지연 로드된 양식 편집기")).toBeVisible();
    expect(lazyEntryMock.loaded).toHaveBeenCalledTimes(1);
  });

  it("새로고침으로 다시 마운트되어도 열려 있던 양식 편집 화면을 복원한다", async () => {
    const firstView = render(<FormTemplateManager token="token" />);
    expect(await screen.findByRole("heading", { name: "양식 관리" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "첫 양식 만들기" }));
    expect(await screen.findByText("지연 로드된 양식 편집기")).toBeVisible();
    expect(window.sessionStorage.getItem(formTemplateEditorSessionStorageKey)).toBeTruthy();

    firstView.unmount();
    render(<FormTemplateManager token="token" />);

    expect(await screen.findByText("지연 로드된 양식 편집기")).toBeVisible();
  });

  it("양식 관리 메뉴를 다시 열면 복원 상태를 지우고 목록을 표시한다", async () => {
    const view = render(<FormTemplateManager token="token" resetKey={0} />);
    expect(await screen.findByRole("heading", { name: "양식 관리" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "첫 양식 만들기" }));
    expect(await screen.findByText("지연 로드된 양식 편집기")).toBeVisible();

    view.rerender(<FormTemplateManager token="token" resetKey={1} />);

    expect(await screen.findByRole("heading", { name: "양식 관리" })).toBeVisible();
    expect(window.sessionStorage.getItem(formTemplateEditorSessionStorageKey)).toBeNull();
  });

  it("기존 임시 수정 내용은 무시하고 서버에서 저장된 문서 양식을 다시 읽는다", async () => {
    const draft = createBlankDraft(100);
    const saved = {
      ...draft,
      id: 1,
      name: "서버에 저장된 제목",
      description: "저장된 설명",
      createdAt: "2026-09-19T00:00:00.000Z",
      createdByLoginId: "admin",
    };
    apiMock.fetchAdminFormTemplates.mockResolvedValue([saved]);
    apiMock.fetchFormTemplate.mockResolvedValue(saved);
    window.sessionStorage.setItem(
      formTemplateEditorSessionStorageKey,
      JSON.stringify({
        sourceId: "template-1",
        dirty: true,
        draft: { ...draft, name: "임시 제목" },
      }),
    );
    render(<FormTemplateManager token="token" />);
    expect(await screen.findByText("지연 로드된 양식 편집기")).toBeVisible();
    expect(apiMock.fetchFormTemplate).toHaveBeenCalledWith("token", saved.code, true);
    expect(lazyEntryMock.render.mock.lastCall?.[0].draft).toMatchObject({
      name: saved.name,
      description: saved.description,
      layout: saved.layout,
      isNew: false,
    });
    expect(JSON.parse(window.sessionStorage.getItem(formTemplateEditorSessionStorageKey)!)).toEqual({
      sourceId: "template-1",
    });
  });

  it("저장하지 않은 새 문서는 편집 화면만 유지하고 기본 내용으로 초기화한다", async () => {
    window.sessionStorage.setItem(
      formTemplateEditorSessionStorageKey,
      JSON.stringify({
        sourceId: "new-100",
        dirty: true,
        draft: { ...createBlankDraft(100), name: "임시 제목", description: "임시 설명" },
      }),
    );
    render(<FormTemplateManager token="token" />);
    expect(await screen.findByText("지연 로드된 양식 편집기")).toBeVisible();
    expect(lazyEntryMock.render.mock.lastCall?.[0].draft).toMatchObject({ name: "", description: "", isNew: true });
    expect(apiMock.fetchFormTemplate).not.toHaveBeenCalled();
  });
});
