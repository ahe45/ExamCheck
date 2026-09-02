// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { TemplateEditorInstance } from "../../shared/templates/template-editor-contracts";
import { closeCandidateBlockFocusEditor } from "examlist-template-editor/examlist/template-editor/candidate-block-grid-focus-editor";
import { enhanceTemplateDataBlock } from "./enhance-template-data-block";
import { createTemplateEditorTransactionCoordinator } from "./editor/template-editor-transaction-coordinator";

describe("ExamList candidate block grid interactions", () => {
  it("이동 핸들과 모서리 핸들로 데이터 블록 위치와 크기를 변경한다", async () => {
    class TestPointerEvent extends MouseEvent {
      pointerId: number;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId || 0;
      }
    }
    Object.defineProperty(window, "PointerEvent", { configurable: true, value: TestPointerEvent });
    const dispatchPointerEvent = (target: EventTarget, type: string, init: PointerEventInit) =>
      target.dispatchEvent(new TestPointerEvent(type, { bubbles: true, cancelable: true, ...init }));

    const root = document.createElement("div");
    root.innerHTML = `
      <div class="template-page-properties-panel"></div>
      <div data-template-editor-runtime-surface class="editor-document-surface" contenteditable="true">
        <div class="template-doc">
          <div data-candidate-block-grid data-candidate-block-object="true" style="position:absolute;left:0;top:0;width:300px;height:200px">
            <div data-candidate-block-instance data-candidate-block-template-role="source"><p>블록</p></div>
          </div>
        </div>
      </div>
    `;
    document.body.append(root);
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const documentElement = surface.querySelector<HTMLElement>(".template-doc")!;
    Object.defineProperties(documentElement, {
      clientHeight: { configurable: true, value: 800 },
      clientWidth: { configurable: true, value: 700 },
    });
    documentElement.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 700, bottom: 800, width: 700, height: 800, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const selectedPage = {
      id: "page-1",
      type: "CONTENT",
      settings: {
        candidateBlockGrid: {
          enabled: true,
          columns: 1,
          rows: 1,
          blockTemplateHtml: "<p>블록</p>",
        },
      },
    };
    const runtime = { state: { templateEditor: {} } };
    const editorSync = vi.fn(() => ({ layout: { pages: [selectedPage] } }));
    const editor = {
      getRuntime: () => runtime,
      getSelectedPageId: () => "page-1",
      getValue: () => ({ layout: { pages: [selectedPage] } }),
      sync: editorSync,
    } as unknown as TemplateEditorInstance;
    const onDirty = vi.fn();
    const transactions = createTemplateEditorTransactionCoordinator({
      documentSurface: surface,
      commit: () => {
        editorSync();
      },
      onDirty,
    });
    const dispose = enhanceTemplateDataBlock(root, editor, transactions);
    const grid = surface.querySelector<HTMLElement>("[data-candidate-block-grid]")!;
    const renderedDocumentElement = grid.closest<HTMLElement>(".template-doc")!;
    Object.defineProperties(renderedDocumentElement, {
      clientHeight: { configurable: true, value: 800 },
      clientWidth: { configurable: true, value: 700 },
    });
    renderedDocumentElement.getBoundingClientRect = documentElement.getBoundingClientRect;
    grid.style.cssText = "position:absolute;left:0;top:0;width:300px;height:200px";
    Object.defineProperties(grid, {
      offsetHeight: { configurable: true, get: () => Number.parseFloat(grid.style.height) || 200 },
      offsetLeft: { configurable: true, get: () => Number.parseFloat(grid.style.left) || 0 },
      offsetTop: { configurable: true, get: () => Number.parseFloat(grid.style.top) || 0 },
      offsetWidth: { configurable: true, get: () => Number.parseFloat(grid.style.width) || 300 },
    });
    grid.getBoundingClientRect = () => {
      const left = Number.parseFloat(grid.style.left) || 0;
      const top = Number.parseFloat(grid.style.top) || 0;
      const width = Number.parseFloat(grid.style.width) || 300;
      const height = Number.parseFloat(grid.style.height) || 200;
      return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON() {},
      } as DOMRect;
    };
    const moveHandle = grid.querySelector<HTMLElement>("[data-candidate-block-grid-move-handle]")!;

    dispatchPointerEvent(moveHandle, "pointerdown", { button: 0, clientX: 10, clientY: 10, pointerId: 3 });
    expect(grid).toHaveClass("is-moving-candidate-block-grid");
    dispatchPointerEvent(window, "pointermove", { clientX: 50, clientY: 35, pointerId: 3 });
    dispatchPointerEvent(window, "pointerup", { clientX: 50, clientY: 35, pointerId: 3 });

    expect(grid.style.left).toBe("40px");
    expect(grid.style.top).toBe("25px");
    expect(grid).toHaveClass("is-selected-candidate-block-grid");

    const resizeHandle = grid.querySelector<HTMLElement>('[data-candidate-block-grid-resize-corner="bottom-right"]')!;
    dispatchPointerEvent(resizeHandle, "pointerdown", { button: 0, clientX: 340, clientY: 225, pointerId: 4 });
    dispatchPointerEvent(window, "pointermove", { clientX: 380, clientY: 255, pointerId: 4 });
    dispatchPointerEvent(window, "pointerup", { clientX: 380, clientY: 255, pointerId: 4 });

    expect(Number.parseFloat(grid.style.width)).toBeGreaterThan(300);
    expect(Number.parseFloat(grid.style.height)).toBeGreaterThan(200);
    await Promise.resolve();
    expect(editorSync).toHaveBeenCalled();
    expect(onDirty).toHaveBeenCalled();

    const portableRuntimePointerDown = vi.fn();
    surface.addEventListener("pointerdown", portableRuntimePointerDown, true);
    const sourceBlock = grid.querySelector<HTMLElement>("[data-candidate-block-instance]")!;
    grid.getBoundingClientRect = () => {
      const left = (Number.parseFloat(grid.style.left) || 0) / 2;
      const top = (Number.parseFloat(grid.style.top) || 0) / 2;
      const width = (Number.parseFloat(grid.style.width) || 300) / 2;
      const height = (Number.parseFloat(grid.style.height) || 200) / 2;
      return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON() {},
      } as DOMRect;
    };
    sourceBlock.getBoundingClientRect = () => {
      const gridRect = grid.getBoundingClientRect();
      return {
        left: gridRect.left,
        top: gridRect.top,
        right: gridRect.right,
        bottom: gridRect.top + 10,
        width: gridRect.width,
        height: 10,
        x: gridRect.left,
        y: gridRect.top,
        toJSON() {},
      } as DOMRect;
    };
    Object.defineProperties(sourceBlock, {
      offsetHeight: { configurable: true, value: 20 },
      offsetWidth: { configurable: true, get: () => grid.offsetWidth },
    });
    const sourceRect = sourceBlock.getBoundingClientRect();
    dispatchPointerEvent(sourceBlock, "pointerdown", {
      button: 0,
      clientX: sourceRect.left + 40,
      clientY: sourceRect.top + 5,
      pointerId: 5,
    });

    expect(document.querySelector("[data-candidate-block-focus-layer]")).toBeTruthy();
    expect(portableRuntimePointerDown).not.toHaveBeenCalled();
    const modalSurface = document.querySelector<HTMLElement>("[data-candidate-block-modal-editor-surface]")!;
    editorSync.mockClear();
    modalSurface.innerHTML = "<p>모달에서 수정됨</p>";
    modalSurface.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(editorSync).not.toHaveBeenCalled();
    expect(closeCandidateBlockFocusEditor()).toBe(true);
    await Promise.resolve();
    expect(editorSync).toHaveBeenCalledTimes(1);
    surface.removeEventListener("pointerdown", portableRuntimePointerDown, true);
    dispose();
    transactions.dispose();
    root.remove();
  });
});
