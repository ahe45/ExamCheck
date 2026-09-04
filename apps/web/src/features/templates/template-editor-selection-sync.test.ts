// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { TemplateEditorInstance } from "../../shared/templates/template-editor-contracts";
import {
  bindTemplateEditorCanvasSelectionPersistence,
  bindTemplateEditorToolbarFocusPersistence,
  syncTemplateEditorPreservingCanvasSelection,
} from "./template-editor-selection-sync";

describe("template editor selection synchronization", () => {
  it("툴바를 연속 클릭하기 직전 활성 편집면의 최신 선택 범위를 다시 저장한다", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="editor-toolbar">
        <button type="button" data-template-command="bold"><span>굵게</span></button>
        <input type="number" data-examlist-object-size="width" />
        <div class="template-table-insert-panel"><input type="number" value="3" /></div>
      </div>
      <div data-template-editor-runtime-surface contenteditable="true">
        <p>기본 캔버스</p>
        <div data-candidate-block-modal-editor-surface="true" data-template-editor-runtime-active-surface="true" contenteditable="true"><p>데이터 블록 내용</p></div>
      </div>
    `;
    document.body.append(root);
    const toolbar = root.querySelector<HTMLElement>(".editor-toolbar")!;
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const modalSurface = root.querySelector<HTMLElement>("[data-template-editor-runtime-active-surface]")!;
    const textNode = modalSurface.querySelector("p")!.firstChild!;
    const runtimeState = {
      savedRange: null as Range | null,
      savedSelectionSnapshot: { startPath: [99] } as unknown,
      suppressToolbarSelectionChange: false,
    };
    const editor = {
      getRuntime: () => ({ state: { templateEditor: runtimeState } }),
    } as unknown as TemplateEditorInstance;
    const dispose = bindTemplateEditorToolbarFocusPersistence(editor, surface, toolbar);
    const select = (start: number, end: number) => {
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    };

    select(0, 3);
    const firstPointer = new MouseEvent("pointerdown", { bubbles: true, button: 0, cancelable: true });
    root.querySelector("[data-template-command] span")!.dispatchEvent(firstPointer);
    expect(firstPointer.defaultPrevented).toBe(true);
    expect(runtimeState.savedRange?.toString()).toBe("데이터");
    expect(runtimeState.savedSelectionSnapshot).toBeNull();
    expect(runtimeState.suppressToolbarSelectionChange).toBe(true);

    select(4, 6);
    const secondPointer = new MouseEvent("pointerdown", { bubbles: true, button: 0, cancelable: true });
    root.querySelector("[data-template-command]")!.dispatchEvent(secondPointer);
    expect(runtimeState.savedRange?.toString()).toBe("블록");

    select(7, 9);
    const inputPointer = new MouseEvent("pointerdown", { bubbles: true, button: 0, cancelable: true });
    root.querySelector("input")!.dispatchEvent(inputPointer);
    expect(inputPointer.defaultPrevented).toBe(false);
    expect(runtimeState.savedRange?.toString()).toBe("내용");

    const tableDimensionInput = root.querySelector<HTMLInputElement>(".template-table-insert-panel input")!;
    const laterWindowKeydown = vi.fn();
    const laterWindowInput = vi.fn();
    window.addEventListener("keydown", laterWindowKeydown, true);
    window.addEventListener("input", laterWindowInput, true);
    const arrowUp = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowUp",
    });
    tableDimensionInput.dispatchEvent(arrowUp);
    expect(arrowUp.defaultPrevented).toBe(false);
    expect(laterWindowKeydown).not.toHaveBeenCalled();
    tableDimensionInput.value = "4";
    tableDimensionInput.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    expect(tableDimensionInput).toHaveValue(4);
    expect(laterWindowInput).not.toHaveBeenCalled();

    const enterKey = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" });
    tableDimensionInput.dispatchEvent(enterKey);
    expect(laterWindowKeydown).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", laterWindowKeydown, true);
    window.removeEventListener("input", laterWindowInput, true);

    dispose();
    root.remove();
  });

  it("문서 동기화로 DOM이 교체되어도 이미지와 데이터 블록 선택을 복원한다", () => {
    const surface = document.createElement("div");
    surface.innerHTML = `
      <div class="template-doc">
        <img class="template-editor-image-object is-selected-object" src="data:image/png;base64,AA==" />
        <div data-candidate-block-grid class="is-selected-candidate-block-grid"></div>
      </div>
    `;
    document.body.append(surface);
    const runtime = {
      state: { templateEditor: { selectedImageElement: null, selectedTableElement: null } },
      updateImageSelectionOverlay: vi.fn(),
      updateTableObjectOverlay: vi.fn(),
    };
    const editor = {
      getRuntime: () => runtime,
      sync: vi.fn(() => {
        surface.innerHTML = `
          <div class="template-doc">
            <img class="template-editor-image-object" src="data:image/png;base64,AA==" />
            <div data-candidate-block-grid></div>
          </div>
        `;
        return {};
      }),
    } as unknown as TemplateEditorInstance;

    syncTemplateEditorPreservingCanvasSelection(editor, surface);

    const nextImage = surface.querySelector<HTMLImageElement>("img")!;
    expect(nextImage).toHaveClass("is-selected-object");
    expect(runtime.state.templateEditor.selectedImageElement).toBe(nextImage);
    expect(surface.querySelector("[data-candidate-block-grid]")).toHaveClass("is-selected-candidate-block-grid");
    expect(runtime.updateImageSelectionOverlay).toHaveBeenCalled();
    expect(runtime.updateTableObjectOverlay).toHaveBeenCalled();
  });

  it.each([
    ["표 셀 내부", "td"],
    ["캔버스 여백", "[data-template-editor-runtime-surface]"],
  ])("선택된 표에서 %s 클릭 시 개체 선택 상태를 다시 복원하지 않는다", (_label, selector) => {
    const surface = document.createElement("div");
    surface.dataset.templateEditorRuntimeSurface = "true";
    surface.innerHTML = `
      <div class="template-doc">
        <table class="is-selected-table-object"><tbody><tr><td>내용</td></tr></tbody></table>
      </div>
    `;
    document.body.append(surface);
    const table = surface.querySelector<HTMLTableElement>("table")!;
    const runtime = {
      state: {
        templateEditor: {
          selectedImageElement: null as HTMLImageElement | null,
          selectedTableElement: table as HTMLTableElement | null,
        },
      },
      updateImageSelectionOverlay: vi.fn(),
      updateTableObjectOverlay: vi.fn(),
    };
    const editor = {
      getRuntime: () => runtime,
    } as unknown as TemplateEditorInstance;
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const dispose = bindTemplateEditorCanvasSelectionPersistence(editor, surface);

    surface.addEventListener(
      "pointerdown",
      () => {
        table.classList.remove("is-selected-table-object");
        runtime.state.templateEditor.selectedTableElement = null;
      },
      { once: true },
    );
    const pointerTarget = selector === "[data-template-editor-runtime-surface]" ? surface : surface.querySelector(selector)!;
    pointerTarget.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));

    expect(table).not.toHaveClass("is-selected-table-object");
    expect(runtime.state.templateEditor.selectedTableElement).toBeNull();
    expect(runtime.updateTableObjectOverlay).not.toHaveBeenCalled();

    dispose();
    requestAnimationFrame.mockRestore();
    surface.remove();
  });
});
