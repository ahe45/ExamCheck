// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { enhanceTemplatePageProperties } from "./enhance-template-page-properties";

describe("enhanceTemplatePageProperties", () => {
  it("페이지 속성을 독립된 우측 열로 묶는다", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="template-editor-runtime-shell">
        <aside class="template-page-properties-panel"><p>페이지 속성</p></aside>
      </div>
    `;

    const enhanced = enhanceTemplatePageProperties(root);
    const column = root.querySelector(".template-page-properties-column");

    expect(column).not.toBeNull();
    expect(column?.firstElementChild).toHaveClass("template-page-properties-panel");
    expect(column?.children).toHaveLength(1);
    expect(column?.querySelector(".template-editor-toolbar-footer")).toBeNull();

    enhanced.dispose();
    expect(root.querySelector(".template-page-properties-column")).toBeNull();
    expect(
      root.querySelector(":scope > .template-editor-runtime-shell > .template-page-properties-panel"),
    ).not.toBeNull();
  });
});
