// @vitest-environment jsdom

import { mountTemplateEditor } from "examlist-template-editor";
import { afterEach, describe, expect, it } from "vitest";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function setup() {
  const root = document.createElement("div");
  document.body.append(root);
  const editor = mountTemplateEditor({
    root,
    initialHtml:
      '<div class="template-doc"><table style="width:300px"><tbody><tr><td>표 내용</td></tr></tbody></table><p><br></p></div>',
    permissions: { canManageTemplates: true },
  });
  cleanups.push(() => {
    editor.destroy();
    root.remove();
  });
  return { root, editor, surface: root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")! };
}

function clipboardEvent(target: Element, type: "copy" | "paste", data: Record<string, string> = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      setData: (key: string, value: string) => {
        data[key] = value;
      },
      getData: (key: string) => data[key] || "",
    },
  });
  target.dispatchEvent(event);
  return { event, data };
}

describe("table object clipboard", () => {
  it("일반 텍스트와 입력 필드의 복사·붙여넣기를 가로채지 않는다", () => {
    const { editor, root, surface } = setup();
    expect(clipboardEvent(surface, "copy").event.defaultPrevented).toBe(false);
    editor.getRuntime().state.templateEditor!.selectedTableElement = surface.querySelector("table");
    const input = document.createElement("input");
    root.append(input);
    input.focus();
    expect(clipboardEvent(input, "copy").event.defaultPrevented).toBe(false);
    expect(
      clipboardEvent(input, "paste", {
        "text/html": '<table data-template-table-clipboard="true"><tr><td>복사본</td></tr></table>',
      }).event.defaultPrevented,
    ).toBe(false);
    expect(surface.querySelectorAll("table")).toHaveLength(1);
  });

  it("표 선택 표시와 중복 ID를 제외하고 복사하며 붙여넣기 전에 HTML을 정리한다", () => {
    const { editor, surface } = setup();
    const original = surface.querySelector("table")!;
    original.id = "source-table";
    original.classList.add("is-selected-table-object");
    editor.getRuntime().state.templateEditor!.selectedTableElement = original;
    surface.focus();
    const { event, data } = clipboardEvent(surface, "copy");
    expect(event.defaultPrevented).toBe(true);
    expect(data["text/plain"]).toBe("표 내용");
    expect(data["text/html"]).toContain('data-template-table-clipboard="true"');
    expect(data["text/html"]).not.toContain("source-table");
    expect(data["text/html"]).not.toContain("is-selected-table-object");
    data["text/html"] = data["text/html"]
      .replace("<td", '<td onclick="alert(1)"')
      .replace("</td>", "<script>alert(1)</script></td>");
    expect(clipboardEvent(surface, "paste", data).event.defaultPrevented).toBe(true);
    expect(surface.querySelectorAll("table")).toHaveLength(2);
    const copy = surface.querySelectorAll("table")[1];
    expect(copy.textContent).toBe("표 내용");
    expect(copy.querySelector("script, [onclick]")).toBeNull();
    expect(copy.hasAttribute("data-template-table-clipboard")).toBe(false);
    expect(original.id).toBe("source-table");
  });

  it("커서 없이 선택한 표는 body에서 발생한 복사도 처리하되 편집기 밖에서는 처리하지 않는다", () => {
    const { editor, surface } = setup();
    editor.getRuntime().state.templateEditor!.selectedTableElement = surface.querySelector("table");
    surface.focus();
    window.getSelection()?.removeAllRanges();
    const copied = clipboardEvent(document.body, "copy");
    expect(copied.event.defaultPrevented).toBe(true);
    expect(copied.data["text/plain"]).toBe("표 내용");
    expect(copied.data["text/html"]).toContain('data-template-table-clipboard="true"');

    const overlay = document.createElement("div") as HTMLDivElement & {
      __templateEditorTableElement: HTMLTableElement | null;
    };
    overlay.className = "template-editor-table-selection";
    overlay.__templateEditorTableElement = surface.querySelector("table");
    const handle = document.createElement("button");
    overlay.append(handle);
    surface.append(overlay);
    handle.focus();
    expect(clipboardEvent(handle, "copy").data["text/plain"]).toBe("표 내용");

    const outside = document.createElement("input");
    document.body.append(outside);
    outside.focus();
    expect(clipboardEvent(document.body, "copy").event.defaultPrevented).toBe(false);
    outside.remove();
    editor.destroy();
    expect(clipboardEvent(document.body, "copy").event.defaultPrevented).toBe(false);
  });
});
