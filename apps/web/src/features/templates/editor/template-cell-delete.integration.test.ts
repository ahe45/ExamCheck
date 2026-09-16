// @vitest-environment jsdom

import { mountTemplateEditor } from "examlist-template-editor";
import { afterEach, expect, it } from "vitest";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function setup() {
  const root = document.createElement("div");
  document.body.append(root);
  const editor = mountTemplateEditor({
    root,
    initialHtml:
      '<div class="template-doc"><table style="width:300px;height:40px"><tbody><tr style="height:40px"><td colspan="2" style="background:#fff0c8">제목</td><td>내용</td></tr></tbody></table><p>본문</p></div>',
    permissions: { canManageTemplates: true },
  });
  cleanups.push(() => {
    editor.destroy();
    root.remove();
  });
  const original = editor.getHtml();
  const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
  const table = surface.querySelector("table")!;
  const cells = [...table.querySelectorAll("td")];
  const state = editor.getRuntime().state.templateEditor!;
  state.tableSelection = { table, anchorCell: cells[0], focusCell: cells[1], selectedCells: cells };
  cells.forEach((cell) => cell.classList.add("is-selected-cell"));
  surface.focus();
  return { root, editor, surface, table, cells, state, original };
}

function press(target: Element, key = "Delete") {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

it("셀 선택이 이전 표 개체 선택보다 우선하며 병합·크기·서식을 유지한다", () => {
  const { surface, table, cells, state, editor, original } = setup();
  state.selectedTableElement = table;
  table.classList.add("is-selected-table-object");
  const styles = [table, ...cells].map((el) => el.style.cssText);
  expect(press(surface).defaultPrevented).toBe(true);
  const retained = surface.querySelector("table")!;
  const retainedCells = [...retained.querySelectorAll("td")];
  expect(surface.querySelectorAll("table")).toHaveLength(1);
  expect(retainedCells.map((cell) => cell.textContent)).toEqual(["", ""]);
  expect(retainedCells[0].colSpan).toBe(2);
  expect([retained, ...retainedCells].map((el) => el.style.cssText)).toEqual(styles);
  expect(state.selectedTableElement).toBeNull();
  editor.getRuntime().undo();
  expect(editor.getHtml()).toBe(original);
});

it("선택 이력이 남아 있어도 별도 입력란이나 편집기 밖의 Delete를 가로채지 않는다", () => {
  const { root, surface, table } = setup();
  const html = table.innerHTML;
  const input = document.createElement("input");
  root.append(input);
  input.focus();
  expect(press(input).defaultPrevented).toBe(false);
  expect(press(surface).defaultPrevented).toBe(false);
  expect(table.innerHTML).toBe(html);
});
