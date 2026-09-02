// @vitest-environment jsdom

import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TemplateEditorInstance } from "../../shared/templates/template-editor-contracts";
import type { TemplateEditorCommandDispatcher } from "./editor/template-editor-command-dispatcher";
import { decorateCatalog, enhanceDataTagPanel, groupDataTags } from "./enhance-data-tag-panel";

describe("groupDataTags", () => {
  it("API가 제공한 실제 시스템 분류와 순서를 유지한다", () => {
    const groups = groupDataTags({
      groups: [
        {
          key: "exam",
          label: "시험 정보",
          tags: [{ key: "candidate.examDate", label: "시험날짜" }],
        },
        {
          key: "candidate",
          label: "수험생 정보",
          tags: [{ key: "candidate.examNo", label: "수험번호" }],
        },
      ],
    });

    expect(groups.map((group) => group.id)).toEqual(["exam", "candidate"]);
    expect(groups.map((group) => group.label)).toEqual(["시험 정보", "수험생 정보"]);
    expect(groups[0]?.tags.map((tag) => tag.key)).toEqual(["candidate.examDate"]);
  });

  it("분류되지 않은 태그는 기타 그룹에 보존한다", () => {
    const groups = groupDataTags({
      groups: [{ key: "system", label: "시스템 정보", tags: [{ key: "system.title" }] }],
      tags: [{ key: "legacy.value", label: "기존 태그" }],
    });

    expect(groups.find((group) => group.id === "etc")?.tags.map((tag) => tag.key)).toEqual(["legacy.value"]);
  });

  it("편집기에 전달하는 토큰 값을 실제 시스템 키로 유지한다", () => {
    const catalog = decorateCatalog({
      groups: [{ key: "exam", label: "시험 정보", tags: [{ key: "candidate.admissionYear", label: "학년도" }] }],
    });

    expect(catalog.groups?.[0]?.tags?.[0]).toEqual(
      expect.objectContaining({
        key: "candidate.admissionYear",
        token: "candidate.admissionYear",
        editorToken: "#학년도",
      }),
    );
  });

  it("태그 버튼 클릭을 공통 명령 경로로 실행해 한 번만 삽입한다", () => {
    const root = document.createElement("div");
    root.innerHTML =
      "<aside data-template-editor-runtime-tag-panel><div data-template-editor-runtime-tags></div></aside>";
    document.body.append(root);
    const insertTag = vi.fn();
    const editor = {
      getHtml: () => "",
      getRuntime: () => ({ insertTag, setHtml: vi.fn() }),
    } as unknown as TemplateEditorInstance;
    const execute = vi.fn((command) => command.mutate());
    const commandDispatcher = { execute } as unknown as TemplateEditorCommandDispatcher;
    const dispose = enhanceDataTagPanel({
      catalog: { groups: [{ key: "candidate", label: "수험생", tags: [{ key: "candidate.name", label: "이름" }] }] },
      commandDispatcher,
      editor,
      onOpenSettings: vi.fn(),
      onViewOptionsChange: vi.fn(),
      root,
      viewOptions: { showIcons: true, showSampleData: false },
    });

    fireEvent.click(root.querySelector(".template-tag-button")!);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ id: "data-tag.insert" }));
    expect(insertTag).toHaveBeenCalledOnce();
    expect(insertTag).toHaveBeenCalledWith("#이름");
    dispose();
    root.remove();
  });
});
