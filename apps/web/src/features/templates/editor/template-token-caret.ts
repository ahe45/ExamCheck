const TOKEN_SELECTOR = ".template-token[contenteditable='false'][data-template-tag-value]";
const INLINE_WRAPPERS = new Set(["SPAN", "B", "STRONG", "I", "EM", "U", "S", "FONT"]);

// Chromium cannot paint a caret at an element boundary after a final atomic tag.
// Create a temporary text position only when the user actually places a caret there.
export function ensureTemplateTokenCaret(surface: HTMLElement): Range | null {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection?.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const container = range.startContainer;
  if (container.nodeType !== Node.ELEMENT_NODE || !surface.contains(container) || range.startOffset === 0) return null;
  let previous = container.childNodes[range.startOffset - 1];
  while (
    previous instanceof HTMLElement &&
    !previous.matches(TOKEN_SELECTOR) &&
    INLINE_WRAPPERS.has(previous.tagName)
  ) {
    if (!previous.lastChild) return null;
    previous = previous.lastChild;
  }
  if (!(previous instanceof HTMLElement) || !previous.matches(TOKEN_SELECTOR)) return null;
  // The main canvas renders data blocks as objects; their separate modal owns editing.
  if (
    previous.closest("[data-candidate-block-grid]") &&
    !surface.matches("[data-candidate-block-modal-editor-surface]")
  )
    return null;
  if (previous.parentElement?.closest("[contenteditable='false']")) return null;

  let text = previous.nextSibling;
  if (text instanceof HTMLElement && text.classList.contains("template-token-caret")) text = text.firstChild;
  if (text?.nodeType !== Node.TEXT_NODE || !text.textContent) {
    const guard = surface.ownerDocument.createElement("span");
    guard.className = "template-token-caret";
    text = surface.ownerDocument.createTextNode("\u200B");
    guard.append(text);
    previous.after(guard);
  }
  range.setStart(text, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return range.cloneRange();
}
