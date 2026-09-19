// @vitest-environment jsdom

import { fireEvent } from "@testing-library/react";
import { mountTemplateEditor } from "examlist-template-editor";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindTemplateEditorCanvasSelectionPersistence } from "./template-editor-selection-sync";

describe("ExamList canvas object runtime", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("이미지를 선택해 이동하고 모서리 핸들로 크기를 조절한다", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const onDirtyChange = vi.fn();
    const editor = mountTemplateEditor({
      root,
      template: {
        layout: {
          pages: [
            {
              id: "page-1",
              type: "CONTENT",
              settings: {
                documentHtml:
                  '<div class="template-doc"><img class="template-editor-image-object" src="data:image/png;base64,AA==" style="width:100px;height:60px" /></div>',
              },
            },
          ],
        },
      },
      dataTags: [],
      permissions: { canManageTemplates: true },
      onDirtyChange,
    });
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const disposeSelectionPersistence = bindTemplateEditorCanvasSelectionPersistence(
      editor as unknown as import("../../shared/templates/template-editor-contracts").TemplateEditorInstance,
      surface,
    );
    const documentElement = surface.querySelector<HTMLElement>(".template-doc")!;
    const image = surface.querySelector<HTMLImageElement>("img")!;
    Object.defineProperties(documentElement, {
      clientHeight: { configurable: true, value: 800 },
      clientWidth: { configurable: true, value: 700 },
    });
    documentElement.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 700, bottom: 800, width: 700, height: 800, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const configureImageGeometry = (target: HTMLImageElement) => {
      Object.defineProperties(target, {
        offsetHeight: { configurable: true, get: () => Number.parseFloat(target.style.height) || 60 },
        offsetLeft: { configurable: true, get: () => Number.parseFloat(target.style.left) || 0 },
        offsetTop: { configurable: true, get: () => Number.parseFloat(target.style.top) || 0 },
        offsetWidth: { configurable: true, get: () => Number.parseFloat(target.style.width) || 100 },
      });
      target.getBoundingClientRect = () => {
        const left = Number.parseFloat(target.style.left) || 0;
        const top = Number.parseFloat(target.style.top) || 0;
        const width = Number.parseFloat(target.style.width) || 100;
        const height = Number.parseFloat(target.style.height) || 60;
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
    };
    configureImageGeometry(image);

    fireEvent.pointerDown(image, { button: 0, clientX: 20, clientY: 20, pointerId: 7 });
    fireEvent.pointerMove(window, { clientX: 70, clientY: 55, pointerId: 7 });
    fireEvent.pointerUp(window, { clientX: 70, clientY: 55, pointerId: 7 });
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    const movedImage = surface.querySelector<HTMLImageElement>("img")!;
    expect(movedImage).toHaveClass("is-selected-object");
    expect(Number.parseFloat(movedImage.style.left)).toBeGreaterThan(0);
    expect(Number.parseFloat(movedImage.style.top)).toBeGreaterThan(0);
    configureImageGeometry(movedImage);
    editor.getRuntime().updateImageSelectionOverlay();

    const resizeHandle = root.querySelector<HTMLElement>(
      ".template-editor-image-selection:not(.hidden) [data-template-resize-corner='bottom-right']",
    )!;
    expect(resizeHandle).toBeTruthy();
    fireEvent.pointerDown(resizeHandle, { button: 0, clientX: 120, clientY: 95, pointerId: 8 });
    fireEvent.pointerMove(window, { clientX: 160, clientY: 125, pointerId: 8 });
    fireEvent.pointerUp(window, { clientX: 160, clientY: 125, pointerId: 8 });
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    const resizedImage = surface.querySelector<HTMLImageElement>("img")!;
    expect(Number.parseFloat(resizedImage.style.width)).toBeGreaterThan(100);
    expect(Number.parseFloat(resizedImage.style.height)).toBeGreaterThan(60);
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    disposeSelectionPersistence();
    editor.destroy();
  });

  it("다른 이미지로 선택을 바꾸면 이전 이미지 선택을 다시 복원하지 않는다", async () => {
    class TestPointerEvent extends MouseEvent {
      pointerId: number;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId || 0;
      }
    }
    Object.defineProperty(window, "PointerEvent", { configurable: true, value: TestPointerEvent });

    const root = document.createElement("div");
    document.body.append(root);
    const editor = mountTemplateEditor({
      root,
      initialHtml:
        '<div class="template-doc"><img src="data:image/png;base64,AA==" style="width:40px;height:40px"><img src="data:image/png;base64,AA==" style="width:40px;height:40px"></div>',
      permissions: { canManageTemplates: true },
    });
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const disposeSelectionPersistence = bindTemplateEditorCanvasSelectionPersistence(
      editor as unknown as import("../../shared/templates/template-editor-contracts").TemplateEditorInstance,
      surface,
    );
    const images = surface.querySelectorAll<HTMLImageElement>("img");

    fireEvent.pointerDown(images[0], { button: 0, pointerId: 21 });
    fireEvent.pointerUp(window, { button: 0, pointerId: 21 });
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    fireEvent.pointerDown(images[1], { button: 0, pointerId: 22 });
    fireEvent.pointerUp(window, { button: 0, pointerId: 22 });
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(images[0]).not.toHaveClass("is-selected-object");
    expect(images[1]).toHaveClass("is-selected-object");
    disposeSelectionPersistence();
    editor.destroy();
  });

  it("절대 위치 표를 반복 동기화해도 흐름 위치 예약 요소를 재생성하지 않는다", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const editor = mountTemplateEditor({
      root,
      initialHtml: `
        <div class="template-doc">
          <p>표 앞 문장</p>
          <table style="position:absolute;left:0;top:40px;width:300px;height:80px"><tbody><tr><td>셀</td></tr></tbody></table>
          <p><br></p>
        </div>
      `,
      permissions: { canManageTemplates: true },
    });
    const documentElement = root.querySelector<HTMLElement>(".template-doc")!;
    const tableElement = documentElement.querySelector<HTMLTableElement>("table")!;
    documentElement.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 700, bottom: 800, width: 700, height: 800, x: 0, y: 0, toJSON() {} }) as DOMRect;
    tableElement.getBoundingClientRect = () =>
      ({ left: 0, top: 40, right: 300, bottom: 120, width: 300, height: 80, x: 0, y: 40, toJSON() {} }) as DOMRect;
    Object.defineProperties(tableElement, {
      offsetHeight: { configurable: true, value: 80 },
      offsetWidth: { configurable: true, value: 300 },
    });

    editor.sync();
    const initialSpacer = documentElement.querySelector<HTMLElement>("[data-template-object-flow-spacer]")!;
    const removeSpacer = vi.spyOn(initialSpacer, "remove");
    const startedAt = performance.now();

    for (let index = 0; index < 20; index += 1) {
      editor.sync();
    }
    const elapsedMs = performance.now() - startedAt;

    expect(documentElement.querySelector("[data-template-object-flow-spacer]")).toBe(initialSpacer);
    expect(documentElement.querySelectorAll("[data-template-object-flow-spacer]")).toHaveLength(1);
    expect(removeSpacer).not.toHaveBeenCalled();
    expect(editor.getHtml()).not.toContain("data-template-object-flow-spacer");
    expect(editor.getHtml()).not.toContain("data-template-object-flow-id");
    expect(elapsedMs).toBeLessThan(2_500);
    editor.destroy();
  });

  it("빈 캔버스에 표를 삽입하면 기존 빈 줄을 중복해서 남기지 않는다", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const editor = mountTemplateEditor({
      root,
      initialHtml: '<div class="template-doc"><p><br></p></div>',
      permissions: { canManageTemplates: true },
    });
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const documentElement = surface.querySelector<HTMLElement>(".template-doc")!;
    const initialParagraph = documentElement.querySelector<HTMLParagraphElement>("p")!;
    const selection = window.getSelection()!;
    const range = document.createRange();

    range.selectNodeContents(initialParagraph);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    surface.focus();
    expect(
      editor.insertHtml('<table style="width:200px;height:80px"><tbody><tr><td>셀</td></tr></tbody></table>'),
    ).not.toBe(false);

    expect(Array.from(documentElement.children).map((element) => element.tagName)).toEqual(["TABLE", "P"]);
    expect(editor.getHtml().match(/<p><br><\/p>/g)).toHaveLength(1);
    editor.destroy();
  });
});
