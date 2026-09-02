// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { TemplateEditorInstance } from "../../shared/templates/template-editor-contracts";
import { createTemplateEditorTransactionCoordinator } from "./editor/template-editor-transaction-coordinator";

const controlsMock = vi.hoisted(() => ({
  alignment: vi.fn(),
  alignmentDispose: vi.fn(),
  lineHeight: vi.fn(),
  lineHeightDispose: vi.fn(),
  pageNumber: vi.fn(),
  pageNumberDispose: vi.fn(),
  size: vi.fn(),
  sizeDispose: vi.fn(),
}));

vi.mock("examlist-template-editor/examlist/template-editor/editor-line-height-control", () => ({
  bindLineHeightControl: controlsMock.lineHeight,
}));
vi.mock("examlist-template-editor/examlist/template-editor/object-alignment-controls", () => ({
  bindObjectAlignmentControls: controlsMock.alignment,
}));
vi.mock("examlist-template-editor/examlist/template-editor/object-size-controls", () => ({
  bindObjectSizeControls: controlsMock.size,
}));
vi.mock("examlist-template-editor/examlist/template-editor/page-number-controls", () => ({
  bindPageNumberControls: controlsMock.pageNumber,
}));

import { enhanceTemplateEditorControls } from "./enhance-template-editor-controls";

describe("enhanceTemplateEditorControls", () => {
  it("줄 간격·개체 크기·개체 정렬·페이지 번호 기능을 현재 편집기에 연결한다", async () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="editor-toolbar"></div>
      <div data-template-editor-runtime-surface></div>
      <aside class="template-page-properties-panel">
        <section class="examlist-candidate-block-grid-field"></section>
      </aside>
    `;
    const page = { id: "content-page", type: "content", settings: {} };
    const runtime = { sync: vi.fn() };
    const sync = vi.fn(() => ({ layout: { pages: [page] } }));
    const editor = {
      getRuntime: () => runtime,
      getSelectedPageId: () => "content-page",
      getValue: () => ({ layout: { pages: [page] } }),
      sync,
    } as unknown as TemplateEditorInstance;
    const onDirty = vi.fn();
    controlsMock.lineHeight.mockReturnValue(controlsMock.lineHeightDispose);
    controlsMock.size.mockReturnValue(controlsMock.sizeDispose);
    controlsMock.alignment.mockReturnValue(controlsMock.alignmentDispose);
    controlsMock.pageNumber.mockImplementation(({ pagePropertiesHost }) => {
      const section = document.createElement("section");
      section.className = "examlist-page-number-field";
      pagePropertiesHost.append(section);
      return controlsMock.pageNumberDispose;
    });

    const documentSurface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const transactions = createTemplateEditorTransactionCoordinator({
      commit: () => sync(),
      documentSurface,
      onDirty,
    });
    const dispose = enhanceTemplateEditorControls(root, editor, transactions);

    expect(controlsMock.lineHeight).toHaveBeenCalledWith(expect.objectContaining({ editor: runtime }));
    expect(controlsMock.size).toHaveBeenCalledWith(expect.objectContaining({ editor: runtime, selectedPage: page }));
    expect(controlsMock.alignment).toHaveBeenCalledWith(expect.objectContaining({ editor: runtime }));
    const pageOptions = controlsMock.pageNumber.mock.calls[0]?.[0];
    expect(pageOptions.appState.templateEditor.selectedPageId).toBe("content-page");
    expect(pageOptions.appState.templateEditor.template).toEqual({ layout: { pages: [page] } });
    expect(root.querySelector(".examlist-candidate-block-grid-field")?.nextElementSibling).toHaveClass(
      "examlist-page-number-field",
    );
    pageOptions.onDirty();
    await Promise.resolve();
    expect(sync).toHaveBeenCalledOnce();
    expect(onDirty).toHaveBeenCalledOnce();

    root.querySelector("[data-template-editor-runtime-surface]")!.innerHTML =
      "<div data-candidate-block-focus-layer></div>";
    pageOptions.onDirty();
    await Promise.resolve();
    expect(sync).toHaveBeenCalledOnce();
    expect(onDirty).toHaveBeenCalledTimes(2);

    dispose();
    transactions.dispose();
    expect(controlsMock.lineHeightDispose).toHaveBeenCalledOnce();
    expect(controlsMock.sizeDispose).toHaveBeenCalledOnce();
    expect(controlsMock.alignmentDispose).toHaveBeenCalledOnce();
    expect(controlsMock.pageNumberDispose).toHaveBeenCalledOnce();
  });
});
