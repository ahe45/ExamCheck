// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  bindObjectPointerControls,
  syncTableObjectOverlayGeometry,
} from "examlist-template-editor/examlist/template-editor/object-pointer-controls";

class TestPointerEvent extends MouseEvent {
  pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId || 0;
  }
}

function dispatchPointerEvent(target: EventTarget, type: string, init: PointerEventInit) {
  target.dispatchEvent(new TestPointerEvent(type, { bubbles: true, cancelable: true, ...init }));
}

describe("template editor object pointer controls", () => {
  it("본문을 꽉 채운 표와 데이터블록은 서브픽셀 테두리 오차로 좌우 이동하지 않는다", () => {
    Object.defineProperty(window, "PointerEvent", { configurable: true, value: TestPointerEvent });
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-template-editor-runtime-surface contenteditable="true">
        <div class="template-doc">
          <table class="is-selected-table-object" style="position:absolute;left:0;top:20px;width:713.8px"></table>
          <div class="examlist-candidate-block-grid is-selected-candidate-block-grid"
            data-candidate-block-grid="true" data-candidate-block-columns="1" data-candidate-block-rows="1"
            style="position:absolute;left:0;top:100px;width:716px;height:200px">
            <div data-candidate-block-instance="1"><p>블록</p></div>
            <span data-candidate-block-grid-move-handle></span>
          </div>
        </div>
      </div>
      <div class="template-editor-table-selection is-selected">
        <button data-template-table-object-move-handle></button>
      </div>
    `;
    document.body.append(root);
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const documentElement = root.querySelector<HTMLElement>(".template-doc")!;
    const table = root.querySelector<HTMLTableElement>("table")!;
    const grid = root.querySelector<HTMLElement>("[data-candidate-block-grid]")!;
    const overlay = root.querySelector<HTMLElement>(".template-editor-table-selection")! as HTMLElement & {
      __templateEditorTableElement?: HTMLTableElement;
    };
    overlay.__templateEditorTableElement = table;
    Object.defineProperties(documentElement, {
      clientHeight: { configurable: true, value: 800 },
      clientWidth: { configurable: true, value: 716 },
      offsetHeight: { configurable: true, value: 802 },
      offsetWidth: { configurable: true, value: 718 },
    });
    documentElement.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 718, bottom: 802, width: 718, height: 802, x: 0, y: 0, toJSON() {} }) as DOMRect;
    table.getBoundingClientRect = () => {
      const left = (Number.parseFloat(table.style.left) || 0) + 0.8;
      return {
        left,
        top: 20.8,
        right: left + 715.8,
        bottom: 70.8,
        width: 715.8,
        height: 50,
        x: left,
        y: 20.8,
        toJSON() {},
      } as DOMRect;
    };
    grid.getBoundingClientRect = () => {
      const left = (Number.parseFloat(grid.style.left) || 0) + 0.8;
      return {
        left,
        top: 100.8,
        right: left + 716.4,
        bottom: 300.8,
        width: 716.4,
        height: 200,
        x: left,
        y: 100.8,
        toJSON() {},
      } as DOMRect;
    };
    const onDirty = vi.fn();
    const dispose = bindObjectPointerControls({
      editor: { updateImageSelectionOverlay: vi.fn(), updateTableObjectOverlay: vi.fn() },
      onDirty,
      rootElement: root,
      selectedPage: { id: "page-1", settings: { candidateBlockGrid: {} } },
      surfaceElement: surface,
    });

    const tableMoveHandle = root.querySelector<HTMLElement>("[data-template-table-object-move-handle]")!;
    dispatchPointerEvent(tableMoveHandle, "pointerdown", { button: 0, clientX: 20, clientY: 30, pointerId: 31 });
    dispatchPointerEvent(window, "pointermove", { clientX: 120, clientY: 30, pointerId: 31 });
    dispatchPointerEvent(window, "pointerup", { clientX: 120, clientY: 30, pointerId: 31 });

    const gridMoveHandle = grid.querySelector<HTMLElement>("[data-candidate-block-grid-move-handle]")!;
    dispatchPointerEvent(gridMoveHandle, "pointerdown", { button: 0, clientX: 20, clientY: 110, pointerId: 32 });
    dispatchPointerEvent(window, "pointermove", { clientX: 120, clientY: 110, pointerId: 32 });
    dispatchPointerEvent(window, "pointerup", { clientX: 120, clientY: 110, pointerId: 32 });

    expect(table.style.left).toBe("0px");
    expect(grid.style.left).toBe("0px");
    expect(onDirty).not.toHaveBeenCalled();
    dispose?.();
    root.remove();
  });

  it("축소된 캔버스에서 표 크기와 위치를 논리 좌표로 변경한다", () => {
    Object.defineProperty(window, "PointerEvent", { configurable: true, value: TestPointerEvent });
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-template-editor-runtime-surface contenteditable="true">
        <div class="template-doc"><table class="is-selected-table-object"></table></div>
      </div>
      <div class="template-editor-table-selection is-selected">
        <button data-template-table-object-move-handle></button>
        <button data-template-table-object-handle data-template-table-object-handle-position="bottom-right"></button>
      </div>
    `;
    document.body.append(root);
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const documentElement = root.querySelector<HTMLElement>(".template-doc")!;
    const table = root.querySelector<HTMLTableElement>("table")!;
    const overlay = root.querySelector<HTMLElement>(".template-editor-table-selection")! as HTMLElement & {
      __templateEditorTableElement?: HTMLTableElement;
    };
    overlay.__templateEditorTableElement = table;
    Object.defineProperties(documentElement, {
      clientHeight: { configurable: true, value: 600 },
      clientWidth: { configurable: true, value: 800 },
    });
    documentElement.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0, toJSON() {} }) as DOMRect;
    table.getBoundingClientRect = () =>
      ({ left: 50, top: 40, right: 150, bottom: 90, width: 100, height: 50, x: 50, y: 40, toJSON() {} }) as DOMRect;
    const editor = { updateImageSelectionOverlay: vi.fn(), updateTableObjectOverlay: vi.fn() };
    const onDirty = vi.fn();
    const dispose = bindObjectPointerControls({
      editor,
      onDirty,
      rootElement: root,
      selectedPage: { id: "page-1", settings: {} },
      surfaceElement: surface,
    });
    const resizeHandle = root.querySelector<HTMLElement>("[data-template-table-object-handle]")!;

    dispatchPointerEvent(resizeHandle, "pointerdown", { button: 0, clientX: 150, clientY: 90, pointerId: 1 });
    dispatchPointerEvent(window, "pointermove", { clientX: 200, clientY: 115, pointerId: 1 });
    dispatchPointerEvent(window, "pointerup", { clientX: 200, clientY: 115, pointerId: 1 });

    expect(table.style.width).toBe("300px");
    expect(table.style.height).toBe("150px");

    const moveHandle = root.querySelector<HTMLElement>("[data-template-table-object-move-handle]")!;
    dispatchPointerEvent(moveHandle, "pointerdown", { button: 0, clientX: 60, clientY: 50, pointerId: 2 });
    dispatchPointerEvent(window, "pointermove", { clientX: 110, clientY: 75, pointerId: 2 });
    dispatchPointerEvent(window, "pointerup", { clientX: 110, clientY: 75, pointerId: 2 });

    expect(table.style.left).toBe("200px");
    expect(table.style.top).toBe("130px");
    expect(onDirty).toHaveBeenCalledTimes(2);
    dispose?.();
    root.remove();
  });

  it("빠르게 연속된 표 크기 조절은 화면 갱신 주기마다 마지막 위치만 계산한다", () => {
    Object.defineProperty(window, "PointerEvent", { configurable: true, value: TestPointerEvent });
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        const frameId = nextFrameId++;
        frames.set(frameId, callback);
        return frameId;
      }),
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: vi.fn((frameId: number) => frames.delete(frameId)),
    });
    const runFrames = () => {
      const pendingFrames = [...frames.entries()];
      frames.clear();
      pendingFrames.forEach(([, callback]) => callback(performance.now()));
    };
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-template-editor-runtime-surface contenteditable="true">
        <div class="template-doc"><table class="is-selected-table-object"><tbody><tr><td>셀</td></tr></tbody></table></div>
      </div>
      <div class="template-editor-table-selection is-selected">
        <button data-template-table-object-handle data-template-table-object-handle-position="bottom-right"></button>
      </div>
    `;
    document.body.append(root);
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const documentElement = root.querySelector<HTMLElement>(".template-doc")!;
    const table = root.querySelector<HTMLTableElement>("table")!;
    const overlay = root.querySelector<HTMLElement>(".template-editor-table-selection")! as HTMLElement & {
      __templateEditorTableElement?: HTMLTableElement;
    };
    overlay.__templateEditorTableElement = table;
    Object.defineProperties(documentElement, {
      clientHeight: { configurable: true, value: 600 },
      clientWidth: { configurable: true, value: 800 },
    });
    documentElement.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0, toJSON() {} }) as DOMRect;
    table.getBoundingClientRect = () =>
      ({ left: 50, top: 40, right: 150, bottom: 90, width: 100, height: 50, x: 50, y: 40, toJSON() {} }) as DOMRect;
    const editor = { updateImageSelectionOverlay: vi.fn(), updateTableObjectOverlay: vi.fn() };
    const onDirty = vi.fn();
    const editorWindow = window as Window & {
      ExamListEditorTableUtils?: {
        buildTemplateTableCellMap: () => { entries: Map<unknown, unknown> };
        ensureTemplateEditorTableColGroup: () => { cellMap: unknown[]; columns: unknown[] };
      };
    };
    const originalTableUtils = editorWindow.ExamListEditorTableUtils;
    const buildTemplateTableCellMap = vi.fn(() => ({ entries: new Map() }));
    editorWindow.ExamListEditorTableUtils = {
      buildTemplateTableCellMap,
      ensureTemplateEditorTableColGroup: () => ({ cellMap: [], columns: [] }),
    };
    const dispose = bindObjectPointerControls({
      editor,
      onDirty,
      rootElement: root,
      selectedPage: { id: "page-1", settings: {} },
      surfaceElement: surface,
    });

    try {
      runFrames();
      const resizeHandle = root.querySelector<HTMLElement>("[data-template-table-object-handle]")!;
      dispatchPointerEvent(resizeHandle, "pointerdown", { button: 0, clientX: 150, clientY: 90, pointerId: 41 });
      for (let index = 1; index <= 80; index += 1) {
        dispatchPointerEvent(window, "pointermove", {
          clientX: 150 + index,
          clientY: 90 + index,
          pointerId: 41,
        });
      }

      expect(frames).toHaveLength(1);
      expect(editor.updateTableObjectOverlay).not.toHaveBeenCalled();
      expect(table.style.width).toBe("200px");

      runFrames();

      expect(editor.updateTableObjectOverlay).toHaveBeenCalledOnce();
      expect(table.style.transform).toContain("scale(1.8, 2.6)");
      expect(buildTemplateTableCellMap).not.toHaveBeenCalled();
      dispatchPointerEvent(window, "pointerup", { clientX: 230, clientY: 170, pointerId: 41 });
      expect(table.style.transform).toBe("");
      expect(table.style.width).toBe("360px");
      expect(table.style.height).toBe("260px");
      expect(buildTemplateTableCellMap).toHaveBeenCalledOnce();
      expect(onDirty).toHaveBeenCalledOnce();
    } finally {
      dispose?.();
      root.remove();
      Object.defineProperty(window, "requestAnimationFrame", {
        configurable: true,
        value: originalRequestAnimationFrame,
      });
      Object.defineProperty(window, "cancelAnimationFrame", {
        configurable: true,
        value: originalCancelAnimationFrame,
      });
      editorWindow.ExamListEditorTableUtils = originalTableUtils;
    }
  });

  it("축소된 캔버스에서 데이터블록 모서리 핸들로 크기를 변경한다", () => {
    Object.defineProperty(window, "PointerEvent", { configurable: true, value: TestPointerEvent });
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-template-editor-runtime-surface contenteditable="true">
        <div class="template-doc">
          <div class="examlist-candidate-block-grid is-selected-candidate-block-grid"
            data-candidate-block-grid="true" data-candidate-block-columns="1" data-candidate-block-rows="1"
            style="position:absolute;left:20px;top:20px;width:300px;height:200px">
            <div data-candidate-block-instance="1"><p>블록</p></div>
            <span data-candidate-block-grid-resize-handle data-candidate-block-grid-resize-corner="bottom-right"></span>
          </div>
        </div>
      </div>
    `;
    document.body.append(root);
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const documentElement = root.querySelector<HTMLElement>(".template-doc")!;
    const grid = root.querySelector<HTMLElement>("[data-candidate-block-grid]")!;
    Object.defineProperties(documentElement, {
      clientHeight: { configurable: true, value: 600 },
      clientWidth: { configurable: true, value: 800 },
    });
    documentElement.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0, toJSON() {} }) as DOMRect;
    grid.getBoundingClientRect = () =>
      ({ left: 10, top: 10, right: 160, bottom: 110, width: 150, height: 100, x: 10, y: 10, toJSON() {} }) as DOMRect;
    const onDirty = vi.fn();
    const dispose = bindObjectPointerControls({
      editor: { updateImageSelectionOverlay: vi.fn(), updateTableObjectOverlay: vi.fn() },
      onDirty,
      rootElement: root,
      selectedPage: { id: "page-1", settings: { candidateBlockGrid: {} } },
      surfaceElement: surface,
    });
    const resizeHandle = root.querySelector<HTMLElement>("[data-candidate-block-grid-resize-handle]")!;

    dispatchPointerEvent(resizeHandle, "pointerdown", { button: 0, clientX: 160, clientY: 110, pointerId: 3 });
    dispatchPointerEvent(window, "pointermove", { clientX: 210, clientY: 135, pointerId: 3 });
    dispatchPointerEvent(window, "pointerup", { clientX: 210, clientY: 135, pointerId: 3 });

    expect(grid.style.width).toBe("400px");
    expect(grid.style.height).toBe("250px");
    expect(onDirty).toHaveBeenCalledOnce();
    dispose?.();
    root.remove();
  });

  it("축소된 캔버스에서 표 선택 테두리와 핸들을 표의 실제 위치에 맞춘다", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-template-editor-runtime-surface contenteditable="true">
        <div class="template-doc"><table></table></div>
        <div class="template-editor-table-selection is-selected"></div>
      </div>
    `;
    document.body.append(root);
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const table = root.querySelector<HTMLTableElement>("table")!;
    const overlay = root.querySelector<HTMLElement>(".template-editor-table-selection")! as HTMLElement & {
      __templateEditorTableElement?: HTMLTableElement;
    };
    overlay.__templateEditorTableElement = table;
    Object.defineProperties(surface, {
      clientHeight: { configurable: true, value: 600 },
      clientWidth: { configurable: true, value: 800 },
    });
    surface.getBoundingClientRect = () =>
      ({ left: 20, top: 10, right: 420, bottom: 310, width: 400, height: 300, x: 20, y: 10, toJSON() {} }) as DOMRect;
    table.getBoundingClientRect = () =>
      ({ left: 70, top: 50, right: 170, bottom: 100, width: 100, height: 50, x: 70, y: 50, toJSON() {} }) as DOMRect;

    syncTableObjectOverlayGeometry(root);

    expect(overlay.style.left).toBe("100px");
    expect(overlay.style.top).toBe("80px");
    expect(overlay.style.width).toBe("200px");
    expect(overlay.style.height).toBe("100px");
    root.remove();
  });
});
