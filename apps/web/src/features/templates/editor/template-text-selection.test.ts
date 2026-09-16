// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { captureTemplateTextSelection, restoreTemplateTextSelection } from "./template-text-selection";

afterEach(() => document.body.replaceChildren());

describe("template text selection bookmarks", () => {
  it("restores a backward partial selection after formatting replaces inline nodes", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>앞 선택한 텍스트 뒤</p>";
    document.body.append(root);
    const text = root.querySelector("p")!.firstChild!;
    window.getSelection()!.setBaseAndExtent(text, 9, text, 2);
    const snapshot = captureTemplateTextSelection(root)!;

    root.innerHTML = '<p>앞 <b><span style="font-size:24pt">선택한 텍스트</span></b> 뒤</p>';
    expect(restoreTemplateTextSelection(root, snapshot)).toBe(true);
    expect(window.getSelection()!.toString()).toBe("선택한 텍스트");
    expect(window.getSelection()!.anchorOffset).toBe(7);
    expect(window.getSelection()!.focusOffset).toBe(0);
  });

  it("restores a replaced tag using its outer boundary without selecting adjacent text", () => {
    const root = document.createElement("div");
    const markup = '<p>앞 <span class="template-token" contenteditable="false">이름</span> 뒤</p>';
    root.innerHTML = markup;
    document.body.append(root);
    const range = document.createRange();
    range.selectNode(root.querySelector(".template-token")!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const snapshot = captureTemplateTextSelection(root)!;

    root.innerHTML = markup;
    expect(restoreTemplateTextSelection(root, snapshot)).toBe(true);
    const selected = window.getSelection()!.getRangeAt(0);
    expect(selected.toString()).toBe("이름");
    expect(selected.startContainer).toBe(root.querySelector("p"));
    expect(selected.startOffset).toBe(1);
    expect(selected.endContainer).toBe(root.querySelector("p"));
    expect(selected.endOffset).toBe(2);
  });

  it("retains a collapsed caret at the end of multiple inline elements", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>앞 <b>뒤</b></p>";
    document.body.append(root);
    const text = root.querySelector("b")!.firstChild!;
    window.getSelection()!.setBaseAndExtent(text, 1, text, 1);
    const snapshot = captureTemplateTextSelection(root)!;
    root.innerHTML = "<p>앞 <i>뒤</i></p>";
    expect(restoreTemplateTextSelection(root, snapshot)).toBe(true);
    expect(window.getSelection()!.isCollapsed).toBe(true);
    expect(window.getSelection()!.anchorNode).toBe(root.querySelector("i")!.firstChild);
    expect(window.getSelection()!.anchorOffset).toBe(1);
  });

  it("does not restore bookmarks into changed or detached content", () => {
    const root = document.createElement("div");
    root.textContent = "원본";
    document.body.append(root);
    window.getSelection()!.selectAllChildren(root);
    const snapshot = captureTemplateTextSelection(root)!;
    root.textContent = "다른 내용";
    expect(restoreTemplateTextSelection(root, snapshot)).toBe(false);
    root.textContent = "원본";
    root.remove();
    expect(restoreTemplateTextSelection(root, snapshot)).toBe(false);
  });
});
