// @vitest-environment jsdom
import { mountTemplateEditor } from "examlist-template-editor";
import { expect, it, vi } from "vitest";

it("앞 음절의 예약 갱신이 다음 음절의 조합 DOM을 교체하지 않는다", async () => {
  vi.useFakeTimers();
  const root = document.createElement("div");
  document.body.append(root);
  const editor = mountTemplateEditor({
    root,
    initialHtml: '<div class="template-doc"><p>작</p></div>',
    permissions: { canManageTemplates: true },
  });
  try {
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const paragraph = surface.querySelector("p")!;
    const composition = (type: string) => surface.dispatchEvent(new CompositionEvent(type, { bubbles: true }));
    surface.focus();
    composition("compositionstart");
    composition("compositionend");
    composition("compositionstart");
    paragraph.textContent = "작ㅅ";
    // A queued control sync must also respect the active IME session.
    editor.getRuntime().sync();
    await vi.runOnlyPendingTimersAsync();
    expect(paragraph.isConnected).toBe(true);
    expect(surface.querySelector("p")!.textContent).toBe("작ㅅ");
    expect(editor.getRuntime().state.templateEditor!.isComposing).toBe(true);
    paragraph.textContent = "작성";
    composition("compositionend");
    await vi.runOnlyPendingTimersAsync();
    expect(surface.querySelector("p")!.textContent).toBe("작성");
    expect(editor.getRuntime().state.templateEditor!.isComposing).toBe(false);
  } finally {
    editor.destroy();
    root.remove();
    vi.useRealTimers();
  }
});
