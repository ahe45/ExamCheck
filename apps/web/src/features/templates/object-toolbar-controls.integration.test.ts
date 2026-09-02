// @vitest-environment jsdom

import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TemplateEditorInstance } from "../../shared/templates/template-editor-contracts";
import { bindObjectAlignmentControls } from "examlist-template-editor/examlist/template-editor/object-alignment-controls";
import { bindObjectSizeControls } from "examlist-template-editor/examlist/template-editor/object-size-controls";
import { syncTemplateEditorPreservingCanvasSelection } from "./template-editor-selection-sync";

describe("ExamList object toolbar controls", () => {
  it("선택한 이미지의 크기와 캔버스 맞춤 위치를 변경한다", async () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="editor-toolbar"><div class="template-toolbar-group examlist-object-control"></div></div>
      <div data-template-editor-runtime-surface contenteditable="true">
        <div class="template-doc"><img class="template-editor-image-object is-selected-object" style="width:100px;height:60px" /></div>
      </div>
    `;
    document.body.append(root);
    const toolbar = root.querySelector<HTMLElement>(".editor-toolbar")!;
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const documentElement = surface.querySelector<HTMLElement>(".template-doc")!;
    const image = surface.querySelector<HTMLImageElement>("img")!;
    documentElement.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500, x: 0, y: 0, toJSON() {} }) as DOMRect;
    image.getBoundingClientRect = () =>
      ({ left: 20, top: 30, right: 120, bottom: 90, width: 100, height: 60, x: 20, y: 30, toJSON() {} }) as DOMRect;
    const editor = { state: { templateEditor: {} }, sync: vi.fn() };

    const disposeSize = bindObjectSizeControls({
      editor,
      selectedPage: { id: "page-1", settings: {} },
      surfaceElement: surface,
      toolbarHost: toolbar,
    });
    const disposeAlignment = bindObjectAlignmentControls({ editor, surfaceElement: surface, toolbarHost: toolbar });
    const widthInput = toolbar.querySelector<HTMLInputElement>('[data-examlist-object-size="width"]')!;
    const alignmentToggle = toolbar.querySelector<HTMLButtonElement>('[data-examlist-object-align-toggle="align"]')!;

    expect(widthInput).toBeEnabled();
    expect(widthInput.value).toBe("100");
    expect(alignmentToggle).toBeEnabled();

    fireEvent.change(widthInput, { target: { value: "140" } });
    expect(image.style.width).toBe("140px");
    expect(editor.sync).toHaveBeenCalled();

    fireEvent.click(alignmentToggle);
    const alignLeft = toolbar.querySelector<HTMLButtonElement>('[data-examlist-object-align="align-left"]')!;
    expect(alignLeft).toBeEnabled();
    fireEvent.click(alignLeft);
    expect(image.style.left).toBe("0px");

    disposeAlignment?.();
    disposeSize?.();
    root.remove();
  });

  it("데이터블록 크기를 연속 변경해도 선택과 크기 입력 활성 상태를 유지한다", async () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="editor-toolbar"><div class="template-toolbar-group examlist-object-control"></div></div>
      <div data-template-editor-runtime-surface contenteditable="true">
        <div class="template-doc">
          <div class="examlist-candidate-block-grid is-selected-candidate-block-grid"
            data-candidate-block-grid="true" data-candidate-block-object="true"
            data-candidate-block-columns="1" data-candidate-block-rows="1"
            style="position:absolute;left:10px;top:20px;width:220px;height:140px">
            <div data-candidate-block-instance="1"><p>블록</p></div>
          </div>
        </div>
      </div>
    `;
    document.body.append(root);
    const toolbar = root.querySelector<HTMLElement>(".editor-toolbar")!;
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const documentElement = surface.querySelector<HTMLElement>(".template-doc")!;
    let grid = surface.querySelector<HTMLElement>("[data-candidate-block-grid]")!;
    Object.defineProperties(documentElement, {
      clientHeight: { configurable: true, value: 600 },
      clientWidth: { configurable: true, value: 500 },
    });
    documentElement.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 500, bottom: 600, width: 500, height: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;
    grid.getBoundingClientRect = () =>
      ({ left: 10, top: 20, right: 230, bottom: 160, width: 220, height: 140, x: 10, y: 20, toJSON() {} }) as DOMRect;

    const runtime = {
      state: { templateEditor: {} },
      sync: vi.fn(() => {
        const replacement = grid.cloneNode(true) as HTMLElement;
        replacement.classList.remove("is-selected-candidate-block-grid");
        grid.replaceWith(replacement);
        grid = replacement;
      }),
      updateImageSelectionOverlay: vi.fn(),
      updateTableObjectOverlay: vi.fn(),
    };
    const editor = {
      getRuntime: () => runtime,
      sync: runtime.sync,
    } as unknown as TemplateEditorInstance;
    const onDirty = vi.fn(() => syncTemplateEditorPreservingCanvasSelection(editor, surface));
    const disposeSize = bindObjectSizeControls({
      editor: runtime,
      onDirty,
      selectedPage: { id: "page-1", settings: { candidateBlockGrid: {} } },
      surfaceElement: surface,
      toolbarHost: toolbar,
    });
    const widthInput = toolbar.querySelector<HTMLInputElement>('[data-examlist-object-size="width"]')!;
    const heightInput = toolbar.querySelector<HTMLInputElement>('[data-examlist-object-size="height"]')!;

    expect(widthInput).toBeEnabled();
    fireEvent.change(widthInput, { target: { value: "280" } });
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(grid.style.width).toBe("280px");
    expect(grid).toHaveClass("is-selected-candidate-block-grid");
    expect(heightInput).toBeEnabled();

    fireEvent.change(heightInput, { target: { value: "190" } });
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(grid.style.height).toBe("190px");
    expect(grid).toHaveClass("is-selected-candidate-block-grid");
    expect(onDirty).toHaveBeenCalledTimes(2);
    disposeSize?.();
    root.remove();
  });
});
