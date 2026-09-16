// @vitest-environment jsdom
import { mountTemplateEditor } from "examlist-template-editor";
import { expect, it } from "vitest";

const copiedBlankHtml =
  '<div style="text-align:center;line-height:16px"><div style="text-align:left"><br></div></div>' +
  "<p><br></p><p><br></p><p><br></p>";

it.each(["Backspace", "Delete"])("%s로 여러 빈 줄을 지울 때 선택 영역을 유지하고 기본 삭제를 허용한다", (key) => {
  const root = document.createElement("div");
  document.body.append(root);
  const editor = mountTemplateEditor({ root, initialHtml: `<div class="template-doc">${copiedBlankHtml}</div>` });
  try {
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const content = surface.querySelector(".template-doc")!;
    surface.focus();
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(content);
    selection.removeAllRanges();
    selection.addRange(range);
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    surface.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(selection.isCollapsed).toBe(false);
    expect(selection.getRangeAt(0).cloneContents().querySelectorAll("br")).toHaveLength(4);
  } finally {
    editor.destroy();
    root.remove();
  }
});

it.each(["Backspace", "Delete"])("%s를 눌러도 마지막 빈 입력 문단과 용지 설정은 남긴다", (key) => {
  const root = document.createElement("div");
  document.body.append(root);
  const editor = mountTemplateEditor({
    root,
    initialHtml: '<div class="template-doc" data-template-page-margin-top="10"><p><br></p></div>',
  });
  try {
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const content = surface.querySelector(".template-doc")!;
    surface.focus();
    const range = document.createRange();
    range.setStart(content.querySelector("p")!, 0);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    surface.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(content.querySelectorAll("br")).toHaveLength(1);
    expect(content.getAttribute("data-template-page-margin-top")).toBe("10");
    expect(content.contains(window.getSelection()!.anchorNode)).toBe(true);
  } finally {
    editor.destroy();
    root.remove();
  }
});
