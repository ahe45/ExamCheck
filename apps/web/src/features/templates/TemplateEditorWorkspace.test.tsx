// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const editorMock = vi.hoisted(() => ({
  destroy: vi.fn(),
  getHtml: vi.fn(() => "<p>양식</p>"),
  getRuntime: vi.fn(() => ({ setHtml: vi.fn() })),
  preview: vi.fn(async () => ({})),
  save: vi.fn(async () => ({ layout: { pages: [] } })),
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
    lifecycleMock.mountProjectTemplateEditor.mockReturnValue(editorMock);
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

    view.rerender(<TemplateEditorWorkspace {...props} />);
    expect(lifecycleMock.mountProjectTemplateEditor).toHaveBeenCalledTimes(1);
    expect(editorMock.destroy).not.toHaveBeenCalled();

    view.unmount();
    expect(lifecycleMock.disposeTagPanel).toHaveBeenCalledTimes(1);
    expect(editorMock.destroy).toHaveBeenCalledTimes(1);
  });
});
