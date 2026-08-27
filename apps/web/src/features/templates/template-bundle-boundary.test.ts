import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("template editor bundle boundary", () => {
  it("운영 PDF 렌더러는 편집기 root/runtime 대신 core 포맷 경계를 사용한다", () => {
    const renderer = source("./template-renderer.ts");
    const formatting = source("./editor/examlist-template-formatting.ts");

    expect(renderer).toContain('from "./editor/examlist-template-formatting"');
    expect(renderer).not.toContain("examlist-template-editor-adapter");
    expect(formatting).toContain('from "examlist-template-editor/core"');
    expect(formatting).not.toMatch(/from ["']examlist-template-editor["']/u);
  });

  it("양식 목록 진입점은 편집기 본체와 스타일을 정적으로 가져오지 않는다", () => {
    const manager = source("./FormTemplateManager.tsx");
    const lazyEntry = source("./TemplateEditorWorkspaceLazy.ts");

    expect(manager).toContain('lazy(() => import("./TemplateEditorWorkspaceLazy"))');
    expect(manager).not.toContain("import { TemplateEditorWorkspace");
    expect(manager).not.toContain("examlist-template-editor-styles");
    expect(lazyEntry).toContain('import "./editor/examlist-template-editor-styles"');
    expect(lazyEntry).toContain('from "./TemplateEditorWorkspace"');
  });
});
