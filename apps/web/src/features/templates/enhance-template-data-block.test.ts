// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { TemplateEditorInstance } from "../../shared/templates/template-editor-contracts";
import { createTemplateEditorTransactionCoordinator } from "./editor/template-editor-transaction-coordinator";

const dataBlockMock = vi.hoisted(() => ({
  bind: vi.fn(),
  dispose: vi.fn(),
  modalOpen: false,
}));

vi.mock("examlist-template-editor/examlist/template-editor/candidate-block-grid-adapter", () => ({
  bindCandidateBlockGridControls: dataBlockMock.bind,
}));

vi.mock("examlist-template-editor/examlist/template-editor/candidate-block-grid-focus-editor", () => ({
  isCandidateBlockFocusEditorOpen: () => dataBlockMock.modalOpen,
}));

import { enhanceTemplateDataBlock } from "./enhance-template-data-block";

describe("enhanceTemplateDataBlock", () => {
  it("선택된 본문 페이지와 편집기 런타임을 ExamList 데이터 블록 기능에 연결한다", async () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <aside class="template-page-properties-panel"></aside>
      <div data-template-editor-runtime-surface></div>
    `;
    const page = { id: "content-page", type: "content", settings: { documentHtml: "<p><br></p>" } };
    const runtime = { setHtml: vi.fn() };
    const sync = vi.fn(() => ({ layout: { pages: [page] } }));
    const onDirty = vi.fn();
    const editor = {
      getRuntime: () => runtime,
      getSelectedPageId: () => "content-page",
      getValue: () => ({ layout: { pages: [page] } }),
      sync,
    } as unknown as TemplateEditorInstance;
    dataBlockMock.bind.mockReturnValue(dataBlockMock.dispose);

    const documentSurface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const transactions = createTemplateEditorTransactionCoordinator({
      commit: () => sync(),
      documentSurface,
      onDirty,
    });
    const dispose = enhanceTemplateDataBlock(root, editor, transactions);
    const options = dataBlockMock.bind.mock.calls[0]?.[0];

    expect(options).toMatchObject({ editor: runtime, selectedPage: page });
    expect(options.appState.templateEditor.selectedPageId).toBe("content-page");
    expect(options.appState.templateEditor.template).toEqual({ layout: { pages: [page] } });
    documentSurface.innerHTML = `
      <div data-candidate-block-focus-layer>
        <div data-candidate-block-modal-editor-surface data-template-editor-runtime-active-surface="true"></div>
      </div>
    `;
    options.onDirty();
    await Promise.resolve();
    expect(sync).not.toHaveBeenCalled();
    expect(onDirty).toHaveBeenCalledTimes(1);

    options.onDirty();
    await Promise.resolve();
    expect(sync).not.toHaveBeenCalled();
    expect(onDirty).toHaveBeenCalledTimes(2);

    documentSurface.replaceChildren();
    options.onDirty();
    await Promise.resolve();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(onDirty).toHaveBeenCalledTimes(3);

    dispose();
    transactions.dispose();
    expect(dataBlockMock.dispose).toHaveBeenCalledTimes(1);
  });
});
