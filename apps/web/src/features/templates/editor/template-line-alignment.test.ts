// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { alignTemplateTextLines } from "./template-line-alignment";

function mount() {
  const content = document.createElement("div");
  content.innerHTML =
    '<p style="text-align:left"><b>첫 줄<br><br><span>가번호 부여대장 [</span></b><span class="template-token" contenteditable="false" data-template-tag-value="candidate.groupName">1조</span><b>]<br><br>본문</b><br>마지막</p><p>다른 문단</p>';
  document.body.append(content);
  return content;
}

function select(start: Node, startOffset: number, end = start, endOffset = startOffset) {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

describe("template line alignment", () => {
  afterEach(() => document.body.replaceChildren());

  for (const mode of ["caret", "title", "tag"] as const) {
    it(`제목 줄만 정렬하고 빈 줄·태그·나머지 문단을 보존한다 (${mode})`, () => {
      const content = mount();
      const text = content.textContent;
      const title = content.querySelector("b > span")!;
      const tag = content.querySelector(".template-token")!;
      if (mode === "tag") {
        const range = document.createRange();
        range.selectNode(tag);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
      } else {
        select(
          title.firstChild!,
          0,
          mode === "title" ? tag.nextSibling!.firstChild! : title.firstChild!,
          mode === "title" ? 1 : 0,
        );
      }
      const selected = window.getSelection()!.toString();
      expect(alignTemplateTextLines(content, "center")).toBe(true);
      const lines = Array.from(content.firstElementChild!.children) as HTMLElement[];
      expect(lines.map((line) => line.textContent)).toEqual([
        "첫 줄",
        "",
        "가번호 부여대장 [1조]",
        "",
        "본문",
        "마지막",
      ]);
      expect(lines.map((line) => line.style.textAlign)).toEqual(["", "", "center", "", "", ""]);
      expect(content.textContent).toBe(text);
      expect(content.querySelectorAll(".template-token")).toHaveLength(1);
      expect(content.querySelector(".template-token")).toHaveAttribute("contenteditable", "false");
      expect(content.lastElementChild).toHaveTextContent("다른 문단");
      expect(window.getSelection()!.toString()).toBe(selected);
      expect(window.getSelection()!.isCollapsed).toBe(mode === "caret");
      // Reapplying must not nest more blocks or duplicate blank lines.
      expect(alignTemplateTextLines(content, "right")).toBe(true);
      expect(content.firstElementChild!.children).toHaveLength(6);
      expect(content.firstElementChild!.children[2]).toHaveStyle({ textAlign: "right" });
    });
  }

  it("선택한 여러 줄과 문단만 정렬하고 선택 끝의 다음 문단은 제외한다", () => {
    const content = mount();
    const title = content.querySelector("b > span")!;
    select(title.firstChild!, 0, content.lastElementChild!.firstChild!, 0);
    expect(alignTemplateTextLines(content, "center")).toBe(true);
    const lines = Array.from(content.firstElementChild!.children) as HTMLElement[];
    expect(lines.map((line) => line.style.textAlign)).toEqual(["", "", "center", "center", "center", "center"]);
    expect(content.lastElementChild).not.toHaveStyle({ textAlign: "center" });
  });

  it("다른 문단까지 선택한 경우 두 문단 모두 적용한다", () => {
    const content = mount();
    const title = content.querySelector("b > span")!;
    select(title.firstChild!, 0, content.lastElementChild!.firstChild!, 3);
    expect(alignTemplateTextLines(content, "right")).toBe(true);
    expect(content.lastElementChild).toHaveStyle({ textAlign: "right" });
  });

  it("빈 줄의 자리 표시 BR은 정렬할 때 늘어나지 않는다", () => {
    const content = mount();
    content.innerHTML = "<div><br></div>";
    select(content.firstElementChild!, 0);
    expect(alignTemplateTextLines(content, "center")).toBe(true);
    expect(content.querySelectorAll("br")).toHaveLength(1);
    expect(content.querySelectorAll("div")).toHaveLength(1);
  });

  it("선택한 명시적 줄만 배분하고 다른 정렬로 전환하면 배분을 해제한다", () => {
    const content = mount();
    const title = content.querySelector("b > span")!;
    select(title.firstChild!, 0);
    expect(alignTemplateTextLines(content, "justify")).toBe(true);
    const line = content.firstElementChild!.children[2] as HTMLElement;
    expect(line.style.textAlignLast).toBe("justify");
    expect(line.style.getPropertyValue("text-justify")).toBe("inter-character");
    expect((content.firstElementChild!.children[0] as HTMLElement).style.textAlignLast).toBe("");
    for (const alignment of ["center", "right", "left"]) {
      expect(alignTemplateTextLines(content, alignment)).toBe(true);
      expect(line.style.textAlign).toBe(alignment);
      expect(line.style.textAlignLast).toBe("auto");
      expect(line.style.getPropertyValue("text-justify")).toBe("auto");
    }
  });

  it("상위 요소의 배분정렬을 상속한 문단도 왼쪽 정렬로 되돌린다", () => {
    const content = mount();
    content.style.textAlignLast = "justify";
    const paragraph = content.lastElementChild as HTMLElement;
    select(paragraph.firstChild!, 0);
    expect(alignTemplateTextLines(content, "left")).toBe(true);
    expect(paragraph.style.textAlignLast).toBe("auto");
  });
});
