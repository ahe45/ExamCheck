// @vitest-environment jsdom
import { mountTemplateEditor } from "examlist-template-editor";
import { expect, it } from "vitest";

it.each([
  ["<p><br></p>", "p", 0],
  ["<p><b><br></b></p>", "p", 0],
  ["<table><tbody><tr><td><br></td></tr></tbody></table>", "td", 0],
  ["<p><br><br></p>", "p", 2],
  ["<p>기존 내용<br>다음 줄</p>", "p", 1],
])("태그 삽입은 빈 영역의 임시 줄바꿈만 제거한다: %s", (html, selector, expectedBreaks) => {
  const root = document.createElement("div");
  document.body.append(root);
  const editor = mountTemplateEditor({
    root,
    initialHtml: '<div class="template-doc">' + html + "</div>",
    permissions: { canManageTemplates: true },
  });
  try {
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const host = surface.querySelector(selector)!;
    surface.focus();
    const range = document.createRange();
    range.setStart(host, 0);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    editor.getRuntime().insertTag("candidate.name");
    const result = surface.querySelector(selector)!;
    expect(result.querySelectorAll("[data-template-tag-value]")).toHaveLength(1);
    expect(result.querySelectorAll("br")).toHaveLength(expectedBreaks);
    if (html.includes("기존 내용")) expect(result.textContent).toContain("기존 내용");
  } finally {
    editor.destroy();
    root.remove();
  }
});
