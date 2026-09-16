// @vitest-environment jsdom

import { getDocumentSurfaceOverflowInfo } from "examlist-template-editor/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

function rectangle(bottom: number): DOMRect {
  return { x: 0, y: 0, left: 0, top: 0, right: 100, bottom, width: 100, height: bottom, toJSON() {} };
}

function mount(html: string) {
  const root = document.createElement("div");
  root.className = "template-doc";
  root.innerHTML = html;
  root.getBoundingClientRect = () => rectangle(100);
  root.querySelectorAll<HTMLElement>("p, img, table").forEach((element) => {
    element.getClientRects = () => [rectangle(Number(element.dataset.bottom || 140))] as unknown as DOMRectList;
  });
  document.body.append(root);
  return root;
}

describe("document overflow after candidate-block resizing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("수십 개의 뒤쪽 빈 문단을 반복 재귀 없이 검사한다", () => {
    const root = mount('<p data-bottom="40">제목</p>' + "<p><br></p>".repeat(80));
    const matches = Element.prototype.matches;
    let checks = 0;
    vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
      // Abort an exponential regression promptly instead of blocking the test
      // process as the old browser implementation did with long blank tails.
      if (++checks > 2000) throw new Error("빈 문단을 반복해서 다시 검사하고 있습니다.");
      return matches.call(this, selector);
    });
    expect(getDocumentSurfaceOverflowInfo(root)).toEqual({ hasOverflow: false, heightOverflow: 0, widthOverflow: 0 });
    expect(checks).toBeLessThan(2000);
  });

  it("표 뒤의 서식이 남은 빈 커서 문단도 제외한다", () => {
    const root = mount(
      '<table data-bottom="100"><tr><td>표</td></tr></table><p data-bottom="150"><span style="font-weight:bold"><u>\u200b<br></u></span></p>',
    );
    expect(getDocumentSurfaceOverflowInfo(root)).toEqual({ hasOverflow: false, heightOverflow: 0, widthOverflow: 0 });
  });

  it.each([
    '<span class="template-token" data-template-tag-value="candidate.name" contenteditable="false"></span>',
    '<img src="example.png">',
  ])("표 뒤 문단의 태그와 이미지 개체는 빈 커서로 취급하지 않는다: %s", (content) => {
    const root = mount('<table data-bottom="100"><tr><td>표</td></tr></table><p data-bottom="150">' + content + "</p>");
    expect(getDocumentSurfaceOverflowInfo(root).hasOverflow).toBe(true);
  });

  it("실제 내용 앞의 빈 줄과 내용 자체의 페이지 초과는 유지한다", () => {
    const root = mount('<p><br></p><p data-bottom="120">실제 내용</p><p data-bottom="300"><br></p>');
    expect(getDocumentSurfaceOverflowInfo(root)).toMatchObject({ hasOverflow: true, heightOverflow: 40 });
  });

  it("이후 편집으로 빈 문단 뒤에 내용이 생기면 다시 측정한다", () => {
    const root = mount("<p><br></p><p><br></p>");
    expect(getDocumentSurfaceOverflowInfo(root).hasOverflow).toBe(false);
    root.lastElementChild!.textContent = "추가한 내용";
    expect(getDocumentSurfaceOverflowInfo(root)).toMatchObject({ hasOverflow: true, heightOverflow: 40 });
  });

  it("데이터 블록 내부 내용과 임시 조절점은 본문 여백 검사에서 제외한다", () => {
    const root = mount(
      '<p data-bottom="40">제목</p><p><br></p><div data-candidate-block-grid="true"><p data-bottom="300">미리보기</p></div><span data-candidate-block-grid-resize-handle="true"><p data-bottom="400">조절점</p></span>',
    );
    expect(getDocumentSurfaceOverflowInfo(root).hasOverflow).toBe(false);
  });
});
