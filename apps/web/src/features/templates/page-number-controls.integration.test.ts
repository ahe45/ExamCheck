// @vitest-environment jsdom

import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { bindPageNumberControls } from "examlist-template-editor/examlist/template-editor/page-number-controls";

describe("ExamList page number controls", () => {
  it("표시 방법과 위치를 페이지 설정 및 캔버스 오버레이에 반영한다", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <aside class="template-page-properties-panel"></aside>
      <div class="template-editor-page">
        <div data-template-editor-runtime-surface></div>
      </div>
    `;
    const page = { id: "page-1", type: "content", settings: {} };
    const appState = { templateEditor: { selectedPageId: page.id, template: { layout: { pages: [page] } } } };
    const panel = root.querySelector<HTMLElement>(".template-page-properties-panel")!;
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const onDirty = vi.fn();

    const dispose = bindPageNumberControls({
      appState,
      onDirty,
      pagePropertiesHost: panel,
      selectedPage: page,
      surfaceElement: surface,
    });
    const enabled = panel.querySelector<HTMLInputElement>('[data-examlist-page-number-setting="enabled"]')!;
    const preset = panel.querySelector<HTMLSelectElement>('[data-examlist-page-number-setting="preset"]')!;
    const position = panel.querySelector<HTMLSelectElement>('[data-examlist-page-number-setting="position"]')!;

    enabled.checked = true;
    fireEvent.change(enabled);
    expect(page.settings).toEqual({
      pageNumber: { enabled: true, position: "center", preset: "numericCurrentTotal" },
    });
    expect(root.querySelector(".template-page-number-overlay")).toHaveTextContent("1/1");
    expect(preset).toBeEnabled();
    expect(position).toBeEnabled();

    preset.value = "currentPageKorean";
    position.value = "right";
    fireEvent.change(position);
    const overlay = root.querySelector<HTMLElement>(".template-page-number-overlay");
    expect(page.settings).toEqual({
      pageNumber: { enabled: true, position: "right", preset: "currentPageKorean" },
    });
    expect(overlay).toHaveTextContent("1페이지");
    expect(overlay?.dataset.pageNumberPosition).toBe("right");
    expect(onDirty).toHaveBeenCalledTimes(2);

    dispose?.();
    expect(root.querySelector(".examlist-page-number-field")).toBeNull();
    expect(root.querySelector(".template-page-number-overlay")).toBeNull();
  });
});
