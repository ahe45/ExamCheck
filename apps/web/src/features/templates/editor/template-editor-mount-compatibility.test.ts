// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { prepareTemplateEditorMount } from "./template-editor-mount-compatibility";

describe("template editor mount compatibility", () => {
  it("크기 조절 중 누적된 블록 뒤쪽 빈 문단은 입력용 한 줄로 정리한다", () => {
    const source = {
      documentHtml:
        '<div class="template-doc"><p>제목</p><div data-candidate-block-grid="true">내용</div>' +
        "<p><br></p>".repeat(70) +
        "</div>",
    };
    const prepared = prepareTemplateEditorMount(source);
    if (typeof prepared === "string") throw new Error("객체 양식이 문자열로 변환되었습니다.");
    const root = document.createElement("div");
    root.innerHTML = prepared.documentHtml ?? "";
    expect(root.querySelectorAll(".template-doc > p")).toHaveLength(2);
    expect(root.querySelector("[data-candidate-block-grid]")).toHaveTextContent("내용");
    expect(source.documentHtml.match(/<p><br><\/p>/gu)).toHaveLength(70);
  });

  it("블록 뒤에 실제 내용이 있거나 블록이 없는 양식의 빈 줄은 유지한다", () => {
    for (const prefix of ['<div data-candidate-block-grid="true"></div><p>후기</p>', "<p>본문</p>"]) {
      const source = { documentHtml: prefix + "<p><br></p><p><br></p>" };
      const prepared = prepareTemplateEditorMount(source);
      if (typeof prepared === "string") throw new Error("객체 양식이 문자열로 변환되었습니다.");
      expect(prepared.documentHtml).toBe(source.documentHtml);
    }
  });

  it("초기화 중에도 저장된 데이터 블록과 뒤쪽 표의 절대 위치를 유지한다", () => {
    const source = {
      layout: {
        pages: [
          {
            settings: {
              documentHtml:
                '<p>앞 문장</p><div data-candidate-block-grid style="position: absolute; top: 157px; left: 20px"></div><p><br></p><table style="position: absolute; top: 1011px"><tbody><tr><td>작성자</td></tr></tbody></table>',
            },
          },
        ],
      },
    };

    const prepared = prepareTemplateEditorMount(source);
    expect(typeof prepared).not.toBe("string");
    if (typeof prepared === "string") throw new Error("객체 양식이 문자열로 변환되었습니다.");
    const preparedHtml = prepared.layout?.pages?.[0]?.settings?.documentHtml ?? "";

    expect(prepared).not.toBe(source);
    expect(source.layout.pages[0].settings.documentHtml).toContain("position: absolute");
    expect(preparedHtml).toContain("position: absolute");
    expect(preparedHtml).toContain("top: 157px");
    expect(preparedHtml).toContain("top: 1011px");
    expect(preparedHtml).toContain("left: 20px");
  });

  it("이미 흐름 배치인 데이터 블록은 변경하지 않는다", () => {
    const source = {
      documentHtml: '<div data-candidate-block-grid style="position: relative; top: 12px"></div>',
    };

    const prepared = prepareTemplateEditorMount(source);

    expect(source.documentHtml).toBe('<div data-candidate-block-grid style="position: relative; top: 12px"></div>');
    const root = document.createElement("div");
    expect(typeof prepared).not.toBe("string");
    if (typeof prepared === "string") throw new Error("객체 양식이 문자열로 변환되었습니다.");
    root.innerHTML = prepared.documentHtml ?? "";
    expect(root.querySelector<HTMLElement>("[data-candidate-block-grid]")?.style.cssText).toContain(
      "position: relative",
    );
    expect(root.querySelector<HTMLElement>("[data-candidate-block-grid]")?.style.top).toBe("12px");
  });
});
