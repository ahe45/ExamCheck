export interface TemplateTextSelection {
  text: string;
  start: number;
  end: number;
  backward: boolean;
}

export function captureTemplateTextSelection(root: HTMLElement): TemplateTextSelection | null {
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const prefix = root.ownerDocument.createRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  prefix.setEnd(range.endContainer, range.endOffset);
  return {
    text: root.textContent || "",
    start,
    end: prefix.toString().length,
    backward: selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset,
  };
}

export function restoreTemplateTextSelection(root: HTMLElement, snapshot: TemplateTextSelection): boolean {
  // Formatting can replace wrappers and token labels. Keep logical text offsets,
  // but never restore a selection into different content (for example after undo).
  if (!root.isConnected || !snapshot.text || root.textContent !== snapshot.text) return false;
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!selection) return false;
  const range = root.ownerDocument.createRange();
  const boundary = (offset: number, end: boolean) => {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const length = node.textContent?.length || 0;
      if (!length || remaining > length || (!end && remaining === length && offset < snapshot.text.length)) {
        remaining -= length;
        continue;
      }
      const token = node.parentElement?.closest(".template-token[contenteditable='false']");
      if (token && root.contains(token)) {
        // Tags are atomic editor objects: select their outer boundary, never
        // place an editable caret inside their protected display text.
        if (end) range.setEndAfter(token);
        else range.setStartBefore(token);
      } else if (end) range.setEnd(node, remaining);
      else range.setStart(node, remaining);
      return true;
    }
    return false;
  };
  if (!boundary(snapshot.start, false)) return false;
  if (snapshot.start !== snapshot.end && !boundary(snapshot.end, true)) return false;
  if (snapshot.start === snapshot.end) range.collapse(true);
  if (snapshot.backward && !range.collapsed) {
    selection.setBaseAndExtent(range.endContainer, range.endOffset, range.startContainer, range.startOffset);
  } else {
    selection.removeAllRanges();
    selection.addRange(range);
  }
  return true;
}
