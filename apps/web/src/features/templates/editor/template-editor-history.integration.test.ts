// @vitest-environment jsdom

import { fireEvent } from "@testing-library/react";
import { mountTemplateEditor } from "examlist-template-editor";
import { describe, expect, it, vi } from "vitest";

describe("template editor formatting history", () => {
  it("서식 정규화를 별도 이력으로 쌓지 않고 Ctrl+Z / 다시 실행을 처리한다", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const onDirtyChange = vi.fn();
    const editor = mountTemplateEditor({
      root,
      initialHtml: '<div class="template-doc"><p style="text-align: left">제목</p><p>본문</p></div>',
      permissions: { canManageTemplates: true },
      onDirtyChange,
    });
    try {
      const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
      const paragraph = () => surface.querySelector<HTMLElement>("p")!;
      const original = editor.getHtml();
      paragraph().style.textAlign = "center";
      editor.sync();
      expect(paragraph().style.textAlign).toBe("center");
      surface.focus();
      fireEvent.keyDown(surface, { key: "z", code: "KeyZ", ctrlKey: true });
      expect(editor.getHtml()).toBe(original);
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
      fireEvent.keyDown(surface, { key: "z", code: "KeyZ", ctrlKey: true, shiftKey: true });
      expect(paragraph().style.textAlign).toBe("center");
      paragraph().style.color = "red";
      editor.sync();
      fireEvent.keyDown(surface, { key: "z", code: "KeyZ", ctrlKey: true });
      expect(paragraph().style.textAlign).toBe("center");
      expect(paragraph().style.color).toBe("");
      fireEvent.keyDown(surface, { key: "z", code: "KeyZ", ctrlKey: true });
      expect(editor.getHtml()).toBe(original);
      fireEvent.keyDown(surface, { key: "y", code: "KeyY", ctrlKey: true });
      expect(paragraph().style.textAlign).toBe("center");
      fireEvent.keyDown(surface, { key: "y", code: "KeyY", ctrlKey: true });
      expect(paragraph().style.color).toBe("red");
    } finally {
      editor.destroy();
      root.remove();
    }
  });
});
