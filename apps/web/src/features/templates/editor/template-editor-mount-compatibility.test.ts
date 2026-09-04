// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { prepareTemplateEditorMount } from "./template-editor-mount-compatibility";

describe("template editor mount compatibility", () => {
  it("기존 절대 위치 수험생 데이터 블록을 초기화 중에만 흐름 배치로 전환한다", () => {
    const source = {
      layout: {
        pages: [
          {
            settings: {
              documentHtml:
                '<p>앞 문장</p><div data-candidate-block-grid style="position: absolute; top: 157px; left: 20px"></div>',
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
    expect(preparedHtml).toContain("position: relative");
    expect(preparedHtml).not.toContain("top: 157px");
    expect(preparedHtml).toContain("left: 20px");
  });

  it("이미 흐름 배치인 데이터 블록은 변경하지 않는다", () => {
    const source = {
      documentHtml: '<div data-candidate-block-grid style="position: relative; top: 12px"></div>',
    };

    const prepared = prepareTemplateEditorMount(source);

    expect(source.documentHtml).toBe(
      '<div data-candidate-block-grid style="position: relative; top: 12px"></div>',
    );
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
