// @vitest-environment jsdom

import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const zoomMock = vi.hoisted(() => ({
  handleWheel: vi.fn(),
  reset: vi.fn(),
  step: vi.fn(),
}));

vi.mock("examlist-template-editor/core", () => ({
  getTemplateEditorCanvasZoomPercentLabel: vi.fn(() => "100%"),
  handleTemplateEditorCanvasZoomWheel: zoomMock.handleWheel,
  resetTemplateEditorCanvasZoom: zoomMock.reset,
  stepTemplateEditorCanvasZoom: zoomMock.step,
}));

import { enhanceTemplateEditorCanvas } from "./enhance-template-editor-canvas";

describe("enhanceTemplateEditorCanvas", () => {
  it("ExamList의 용지 스타일과 확대/축소 UI를 복원한다", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="template-editor-page" data-template-editor-canvas data-template-editor-canvas-zoom="1">
        <div class="editor-paper-scale-box" data-template-editor-canvas-scale-box>
          <div class="template-editor-surface" data-template-editor-runtime-surface contenteditable="true"></div>
        </div>
      </div>
    `;

    const dispose = enhanceTemplateEditorCanvas(root);
    const canvas = root.querySelector<HTMLElement>("[data-template-editor-canvas]");
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]");

    expect(canvas).toHaveClass("editor-canvas-column");
    expect(canvas).toHaveAttribute("aria-label", "본문 캔버스");
    expect(surface).toHaveClass("editor-paper", "editor-document-surface", "editable");
    expect(surface).toHaveAttribute("spellcheck", "false");
    expect(root.querySelector(".template-editor-canvas-zoom-controls")).not.toBeNull();

    fireEvent.click(root.querySelector<HTMLButtonElement>("[data-template-editor-canvas-zoom-direction='1']")!);
    expect(zoomMock.step).toHaveBeenCalledWith(expect.any(Object), 1, { rootElement: canvas });

    fireEvent.click(root.querySelector<HTMLButtonElement>("[data-action='reset-template-editor-canvas-zoom']")!);
    expect(zoomMock.reset).toHaveBeenCalledWith(expect.any(Object), { rootElement: canvas });

    fireEvent.wheel(canvas!, { ctrlKey: true, deltaY: -1 });
    expect(zoomMock.handleWheel).toHaveBeenCalled();

    Object.defineProperties(canvas!, {
      clientHeight: { configurable: true, value: 400 },
      clientWidth: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1200 },
      scrollWidth: { configurable: true, value: 600 },
    });
    fireEvent.wheel(surface!, { deltaY: 120 });
    expect(canvas?.scrollTop).toBe(120);

    dispose();
    expect(root.querySelector(".template-editor-canvas-zoom-controls")).toBeNull();
  });
});
