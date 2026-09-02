// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { serializeTemplateEditorHtml, serializeTemplateEditorValue } from "./template-editor-serialization";

describe("template editor serialization boundary", () => {
  it("선택 오버레이·이동/크기 핸들·모달 레이어와 임시 상태를 제거한다", () => {
    const html = serializeTemplateEditorHtml(`
      <div class="template-doc">
        <img class="template-editor-image-object is-selected-object is-image-resizing-bottom-right" draggable="false" src="data:image/png;base64,AA==">
        <table class="is-selected-table-object"><tbody><tr><td class="is-active-cell">값</td></tr></tbody></table>
        <div data-candidate-block-grid class="is-selected-candidate-block-grid is-moving-candidate-block-grid">
          <div data-candidate-block-instance><p>블록</p></div>
          <button data-candidate-block-grid-move-handle></button>
          <i data-candidate-block-grid-resize-handle></i>
        </div>
        <div class="template-editor-table-selection"><button class="template-editor-table-handle"></button></div>
        <div data-candidate-block-focus-layer><div data-candidate-block-modal-editor-surface>초안</div></div>
      </div>
    `);

    expect(html).toContain("data-candidate-block-grid");
    expect(html).toContain("data-candidate-block-instance");
    expect(html).toContain("data:image/png;base64,AA==");
    expect(html).not.toMatch(/selection|resize-handle|move-handle|focus-layer|modal-editor-surface/u);
    expect(html).not.toMatch(/is-(?:selected|moving|resizing|active-cell)|draggable/u);
  });

  it("모든 페이지와 데이터블록 변형 HTML을 복제·정리하고 원본 객체는 변경하지 않는다", () => {
    const source = {
      layout: {
        pages: [
          {
            settings: {
              documentHtml: '<p class="is-selected-object">본문</p><div class="template-editor-image-selection"></div>',
              candidateBlockGrid: {
                blockTemplateHtml: "<p>데이터</p><button data-candidate-block-grid-move-handle></button>",
                emptyBlockLayer: { templateHtml: '<p class="is-active-cell">빈 값</p>' },
                columnNameRow: { templateHtml: '<p class="is-selected-cell">컬럼</p>' },
              },
            },
          },
        ],
      },
    };

    const serialized = serializeTemplateEditorValue(source);
    expect(serialized).not.toBe(source);
    expect(JSON.stringify(serialized)).not.toMatch(/is-selected|is-active-cell|move-handle/u);
    expect(JSON.stringify(source)).toMatch(/is-selected-object|move-handle/u);
  });
});
