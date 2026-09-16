// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { ensureTemplateTokenCaret } from "./template-token-caret";
import { serializeTemplateEditorHtml } from "./template-editor-serialization";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});
const tokenHtml =
  '<span class="template-token" contenteditable="false" data-template-tag-value="candidate.roomName">고사실</span>';

function fixture(suffix = "") {
  const surface = document.createElement("div");
  surface.contentEditable = "true";
  surface.innerHTML = `<p>대기실 <span style="font-size:14px">${tokenHtml}${suffix}</span></p>`;
  document.body.append(surface);
  const token = surface.querySelector(".template-token")!;
  const range = document.createRange();
  range.setStartAfter(token);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  return { surface, token, range };
}

it("마지막 태그 뒤에 텍스트 커서를 만들고 반복해도 보조 위치를 중복 생성하지 않는다", () => {
  const { surface, token } = fixture();
  const original = surface.innerHTML;
  expect(ensureTemplateTokenCaret(surface)?.startContainer.nodeType).toBe(Node.TEXT_NODE);
  expect(window.getSelection()!.isCollapsed).toBe(true);
  expect(token).toHaveAttribute("contenteditable", "false");
  const range = document.createRange();
  range.setStartAfter(token);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  ensureTemplateTokenCaret(surface);
  expect(surface.querySelectorAll(".template-token-caret")).toHaveLength(1);
  expect(serializeTemplateEditorHtml(surface.innerHTML)).toBe(original);
});

it("기존 뒤쪽 텍스트를 사용하고 태그 자체의 선택은 유지한다", () => {
  const { surface, token, range } = fixture("뒤 내용");
  expect(ensureTemplateTokenCaret(surface)?.startContainer).toBe(token.nextSibling);
  expect(surface.querySelector(".template-token-caret")).toBeNull();
  range.selectNode(token);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  expect(ensureTemplateTokenCaret(surface)).toBeNull();
  expect(window.getSelection()!.toString()).toBe("고사실");
});

it("저장할 때 보조 문자만 제거하고 추가한 텍스트와 서식은 보존한다", () => {
  const { surface } = fixture();
  ensureTemplateTokenCaret(surface);
  surface.querySelector(".template-token-caret")!.innerHTML = "<b>추가 내용</b>\u200B";
  const html = serializeTemplateEditorHtml(surface.innerHTML);
  expect(html).toContain("<b>추가 내용</b>");
  expect(html).toContain(tokenHtml);
  expect(html).not.toMatch(/template-token-caret|\u200B/u);
});

it("본문의 데이터블록 미리보기에는 보조 커서를 추가하지 않는다", () => {
  const { surface, token } = fixture();
  token.parentElement!.setAttribute("data-candidate-block-grid", "true");
  expect(ensureTemplateTokenCaret(surface)).toBeNull();
});
