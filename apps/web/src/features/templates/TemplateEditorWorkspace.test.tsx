// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const editorMock = vi.hoisted(() => ({
  destroy: vi.fn(),
  getHtml: vi.fn(() => "<p>양식</p>"),
  getRuntime: vi.fn(() => ({ setHtml: vi.fn() })),
  getSelectedPageId: vi.fn(() => ""),
  getValue: vi.fn(() => ({ layout: { pages: [] } })),
  preview: vi.fn(async () => ({})),
  save: vi.fn(async () => ({ layout: { pages: [] } })),
  sync: vi.fn(() => ({ layout: { pages: [] } })),
}));

const lifecycleMock = vi.hoisted(() => ({
  disposeTagPanel: vi.fn(),
  enhanceDataTagPanel: vi.fn(),
  mountProjectTemplateEditor: vi.fn(),
}));

vi.mock("./editor/examlist-template-editor-adapter", () => ({
  mountProjectTemplateEditor: lifecycleMock.mountProjectTemplateEditor,
  renderProjectDataTagIcon: vi.fn(() => "<svg></svg>"),
}));

vi.mock("./enhance-data-tag-panel", () => ({
  decorateCatalog: vi.fn((catalog) => catalog),
  enhanceDataTagPanel: lifecycleMock.enhanceDataTagPanel,
  groupDataTags: vi.fn(() => []),
  readDataTagViewOptions: vi.fn(() => ({ showIcons: true, showSampleData: false })),
}));

vi.mock("../../shared/api/form-templates", () => ({
  fetchAdminFormTemplates: vi.fn(async () => []),
  saveFormTemplate: vi.fn(),
}));

vi.mock("./template-renderer", () => ({
  openTemplatePrintWindow: vi.fn(),
  renderTemplateHtml: vi.fn((html: string) => html),
}));

import { TemplateEditorWorkspace } from "./TemplateEditorWorkspace";
import { createBlankDraft } from "./template-manager-model";

describe("TemplateEditorWorkspace lifecycle", () => {
  beforeEach(() => {
    lifecycleMock.mountProjectTemplateEditor.mockReset();
    lifecycleMock.enhanceDataTagPanel.mockReset();
    editorMock.destroy.mockReset();
    lifecycleMock.disposeTagPanel.mockReset();
    lifecycleMock.mountProjectTemplateEditor.mockImplementation((options: { root: HTMLElement }) => {
      options.root.innerHTML = `
        <div class="template-editor-runtime-shell">
          <div class="editor-toolbar"></div>
          <div data-template-editor-runtime-surface></div>
          <aside class="template-page-properties-panel"><p>페이지 속성</p></aside>
        </div>
      `;
      return editorMock;
    });
    lifecycleMock.enhanceDataTagPanel.mockReturnValue(lifecycleMock.disposeTagPanel);
  });

  it("동일 소스에서는 한 번만 마운트하고 언마운트 때 한 번만 정리한다", () => {
    const draft = createBlankDraft(100);
    const props = {
      token: "token",
      sourceId: "template-1",
      draft,
      dataTags: { tags: [] },
      initialInformationOpen: false,
      notice: null,
      onClose: vi.fn(),
      onDraftChange: vi.fn(),
      onDirtyChange: vi.fn(),
      onNoticeChange: vi.fn(),
      onTemplateSaved: vi.fn(),
    };

    const view = render(<TemplateEditorWorkspace {...props} />);
    expect(lifecycleMock.mountProjectTemplateEditor).toHaveBeenCalledTimes(1);
    expect(lifecycleMock.mountProjectTemplateEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        generatedObjectSourceKey: "candidate.examNo",
        previewData: expect.any(Object),
        adapters: expect.objectContaining({ buildApiUrl: expect.any(Function) }),
      }),
    );

    view.rerender(<TemplateEditorWorkspace {...props} />);
    expect(lifecycleMock.mountProjectTemplateEditor).toHaveBeenCalledTimes(1);
    expect(editorMock.destroy).not.toHaveBeenCalled();

    view.unmount();
    expect(lifecycleMock.disposeTagPanel).toHaveBeenCalledTimes(1);
    expect(editorMock.destroy).toHaveBeenCalledTimes(1);
  });

  it("입력 라벨과 목록 이동을 제공하고 변경 전에는 저장 버튼을 비활성화한다", () => {
    const onClose = vi.fn();
    const draft = createBlankDraft(100);
    const view = render(
      <TemplateEditorWorkspace
        token="token"
        sourceId="template-1"
        draft={draft}
        dataTags={{ tags: [] }}
        initialInformationOpen={false}
        notice={null}
        onClose={onClose}
        onDraftChange={vi.fn()}
        onDirtyChange={vi.fn()}
        onNoticeChange={vi.fn()}
        onTemplateSaved={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "양식 정보" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("양식 목록으로 돌아가기")).not.toBeInTheDocument();
    expect(screen.queryByText("v새 양식")).not.toBeInTheDocument();
    expect(screen.getByText("제목", { selector: ".template-editor-context-field > span" })).toBeVisible();
    expect(screen.getByText("설명", { selector: ".template-editor-context-field > span" })).toBeVisible();
    expect(screen.queryByText("저장되지 않음")).not.toBeInTheDocument();
    const listButton = screen.getByRole("button", { name: "양식 목록" });
    expect(listButton.querySelector(".button-action-icon")).not.toBeNull();
    fireEvent.click(listButton);
    expect(onClose).toHaveBeenCalledTimes(1);
    const contextActions = document.querySelector<HTMLElement>(".template-editor-context-actions");
    expect(contextActions).not.toBeNull();
    expect(screen.getByRole("button", { name: "미리보기" })).toBeVisible();
    const saveButton = screen.getByRole("button", { name: "저장" });
    expect(saveButton).toBeDisabled();
    expect(Array.from(contextActions!.querySelectorAll("button")).map((button) => button.textContent?.trim())).toEqual([
      "양식 목록",
      "미리보기",
      "저장",
    ]);

    view.rerender(
      <TemplateEditorWorkspace
        token="token"
        sourceId="template-1"
        draft={{ ...draft, name: "수정된 양식" }}
        dataTags={{ tags: [] }}
        initialInformationOpen={false}
        notice={null}
        onClose={onClose}
        onDraftChange={vi.fn()}
        onDirtyChange={vi.fn()}
        onNoticeChange={vi.fn()}
        onTemplateSaved={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();

    view.rerender(
      <TemplateEditorWorkspace
        token="token"
        sourceId="template-1"
        draft={draft}
        dataTags={{ tags: [] }}
        initialInformationOpen={false}
        notice={null}
        onClose={onClose}
        onDraftChange={vi.fn()}
        onDirtyChange={vi.fn()}
        onNoticeChange={vi.fn()}
        onTemplateSaved={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });
});
