// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  reflowTemplateEditorObjectRows,
  syncTemplateEditorObjectFlowObjects,
} from "examlist-template-editor/dom";

function rect({ height, top, width = 600 }: { height: number; top: number; width?: number }): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: width,
    top,
    width,
    x: 0,
    y: top,
    toJSON() {},
  } as DOMRect;
}

describe("template editor object flow reflow", () => {
  it("표 이동 이후 반복 동기화에서도 유효한 위치 예약 요소를 다시 만들지 않는다", () => {
    const documentElement = document.createElement("div");
    documentElement.className = "template-doc";
    documentElement.innerHTML = `
      <p>표 앞 문장</p>
      <table style="position:absolute;left:0;top:40px;width:300px;height:80px"><tbody><tr><td>셀</td></tr></tbody></table>
      <p><br></p>
    `;
    document.body.append(documentElement);
    const tableElement = documentElement.querySelector("table")!;
    documentElement.getBoundingClientRect = () => rect({ height: 800, top: 0 });
    tableElement.getBoundingClientRect = () => rect({ height: 80, top: 40, width: 300 });
    Object.defineProperties(tableElement, {
      offsetHeight: { configurable: true, value: 80 },
      offsetWidth: { configurable: true, value: 300 },
    });

    reflowTemplateEditorObjectRows(tableElement, {
      activeHeight: 80,
      activeTop: 40,
      documentElement,
      strictGeometry: true,
    });

    const initialFlowId = tableElement.dataset.templateObjectFlowId;
    const initialSpacer = documentElement.querySelector<HTMLElement>("[data-template-object-flow-spacer]")!;
    const removeSpacer = vi.spyOn(initialSpacer, "remove");
    const observer = new MutationObserver(() => undefined);
    observer.observe(documentElement, { attributes: true, childList: true, subtree: true });

    for (let index = 0; index < 100; index += 1) {
      syncTemplateEditorObjectFlowObjects(documentElement);
    }

    const repeatedSyncMutations = observer.takeRecords();
    observer.disconnect();
    expect(tableElement.dataset.templateObjectFlowId).toBe(initialFlowId);
    expect(documentElement.querySelector("[data-template-object-flow-spacer]")).toBe(initialSpacer);
    expect(documentElement.querySelectorAll("[data-template-object-flow-spacer]")).toHaveLength(1);
    expect(removeSpacer).not.toHaveBeenCalled();
    expect(repeatedSyncMutations).toHaveLength(0);
    documentElement.remove();
  });
});
