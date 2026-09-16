// @vitest-environment jsdom

import { mountTemplateEditor } from "examlist-template-editor";
import { describe, expect, it } from "vitest";

describe("candidate block table dimensions", () => {
  it("레이아웃이 없는 저장용 HTML 복사본에서도 표와 셀 크기를 유지한다", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const editor = mountTemplateEditor({
      root,
      initialHtml: `<div class="template-doc"><div data-candidate-block-instance="1">
        <table style="width: 600px; height: 80px"><colgroup><col style="width: 200px"><col style="width: 400px"></colgroup>
        <tbody><tr style="height: 30px"><td>수험번호</td><td>성명</td></tr>
        <tr style="height: 50px"><td>12345</td><td>수험생</td></tr></tbody></table>
        </div></div>`,
      permissions: { canManageTemplates: true },
    });
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        const html = editor.getHtml();
        const parsed = new DOMParser().parseFromString(html, "text/html");
        const table = parsed.querySelector("table")!;
        expect(table.style.width).toBe("600px");
        expect(table.style.height).toBe("80px");
        expect([...table.querySelectorAll("col")].map((col) => col.style.width)).toEqual(["200px", "400px"]);
        expect([...table.rows].map((row) => row.style.height)).toEqual(["30px", "50px"]);
        expect(table.textContent).toContain("수험생");
        editor.setHtml(html);
        editor.sync();
      }
    } finally {
      editor.destroy();
      root.remove();
    }
  });
});
