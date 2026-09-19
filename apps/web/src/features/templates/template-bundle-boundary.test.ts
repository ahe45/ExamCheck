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
    expect(formatting).toContain('from "../data-tag-formatting"');
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

  it("ExamList 편집기 런타임은 기능 경계별 청크로 분리한다", () => {
    const viteConfig = source("../../../vite.config.ts");

    expect(viteConfig).toContain("template-editor-runtime-foundation.bundle.js");
    expect(viteConfig).toContain("template-editor-runtime-objects.bundle.js");
    expect(viteConfig).toContain("template-editor-runtime-bootstrap.bundle.js");
    expect(viteConfig).toContain("manualChunks: getTemplateEditorRuntimeChunk");
  });

  it("양식 카드가 여러 줄이어도 브라우저의 단일 세로 스크롤로 끝까지 확인한다", () => {
    const adminStyles = source("../../styles/legacy-admin.css");
    const libraryRule = Array.from(
      adminStyles.matchAll(/\.examlist-template-library\s*\{(?<body>[^}]*)\}/gu),
      (match) => match.groups?.body || "",
    ).find((body) => body.includes("100dvh"));

    expect(adminStyles).toContain(".exam-admin-content.template-admin-main:has(.examlist-template-library)");
    expect(adminStyles).toMatch(
      /\.exam-admin-content\.template-admin-main:has\(\.examlist-template-library\)\s*\{[^}]*height: auto;[^}]*overflow: visible;/su,
    );
    expect(libraryRule).toContain("min-height: calc(100dvh");
    expect(libraryRule).toContain("overflow: visible");
    expect(libraryRule).not.toContain("overflow-y: auto");
  });
});
