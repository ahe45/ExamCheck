import type { TemplateEditorInstance } from "../../../shared/templates/template-editor-contracts";
import type { TemplateEditorCommandDispatcher } from "./template-editor-command-dispatcher";
import { captureTemplateTextSelection, restoreTemplateTextSelection } from "./template-text-selection";

const BLOCK_SELECTOR = "p, div, h1, h2, h3, h4, h5, h6, li, td, th, blockquote";
const ALIGNMENTS: Record<string, string> = {
  justifyLeft: "left",
  justifyCenter: "center",
  justifyRight: "right",
  justifyFull: "justify",
};

function applyLineAlignment(element: HTMLElement, alignment: string) {
  element.style.textAlign = alignment;
  // Distributed alignment includes single lines and the last line of a
  // paragraph. Reset inherited distribution when choosing another alignment.
  element.style.textAlignLast = alignment === "justify" ? "justify" : "auto";
  element.style.setProperty("text-justify", alignment === "justify" ? "inter-character" : "auto");
}

function intersectsLine(selection: Range, line: Range) {
  if (selection.collapsed) {
    return line.comparePoint(selection.startContainer, selection.startOffset) === 0;
  }
  if (
    selection.compareBoundaryPoints(Range.END_TO_START, line) >= 0 ||
    selection.compareBoundaryPoints(Range.START_TO_END, line) <= 0
  )
    return false;
  const startsBefore = selection.compareBoundaryPoints(Range.START_TO_START, line) <= 0;
  const endsAfter = selection.compareBoundaryPoints(Range.END_TO_END, line) >= 0;
  if (startsBefore && endsAfter) return true;
  const intersection = line.cloneRange();
  if (!startsBefore) intersection.setStart(selection.startContainer, selection.startOffset);
  if (!endsAfter) intersection.setEnd(selection.endContainer, selection.endOffset);
  const fragment = intersection.cloneContents();
  // A selection ending at offset zero of the next line's text has crossed its
  // opening wrappers, but has not selected any of that line's content.
  return Boolean(fragment.textContent || fragment.querySelector("br, img, .template-token"));
}

// Older templates use BRs inside a single paragraph. Browser alignment and the
// runtime's token alignment both treat that entire paragraph as one target.
// Keep its outer presentation, but give each explicit line its own block.
export function alignTemplateTextLines(content: HTMLElement, alignment: string): boolean {
  const selection = content.ownerDocument.defaultView?.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) return false;
  const snapshot = captureTemplateTextSelection(content);
  const blocks = Array.from(content.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)).filter(
    (block) => !block.querySelector(BLOCK_SELECTOR) && !block.closest("[contenteditable='false']"),
  );
  const targets = blocks.map((block) => {
    const breaks = Array.from(block.querySelectorAll("br")).filter((br) => !br.closest("[contenteditable='false']"));
    const isPlaceholder = breaks.length === 1 && !block.textContent && !block.querySelector("img, .template-token");
    const separators = isPlaceholder ? [] : breaks;
    const lines = Array.from({ length: separators.length + 1 }, (_, index) => {
      const line = content.ownerDocument.createRange();
      line.selectNodeContents(block);
      if (index > 0) line.setStartAfter(separators[index - 1]);
      if (index < separators.length) line.setEndBefore(separators[index]);
      return { range: line, selected: intersectsLine(range, line) };
    });
    return { block, lines, split: separators.length > 0 };
  });
  let changed = false;
  for (const { block, lines, split } of targets) {
    if (!lines.some((line) => line.selected)) continue;
    changed = true;
    if (!split) {
      applyLineAlignment(block, alignment);
      continue;
    }

    const fragments = lines.map((line) => line.range.cloneContents());
    // P and heading elements cannot contain DIVs in persisted HTML. Use a DIV
    // with the original attributes and computed paragraph presentation instead.
    let container = block;
    if (block.matches("p, h1, h2, h3, h4, h5, h6")) {
      container = content.ownerDocument.createElement("div");
      for (const attribute of Array.from(block.attributes)) container.setAttribute(attribute.name, attribute.value);
      const style = content.ownerDocument.defaultView?.getComputedStyle(block);
      for (const property of ["margin-top", "margin-bottom", "font-size", "font-weight", "line-height"]) {
        const value = style?.getPropertyValue(property);
        if (value) container.style.setProperty(property, value);
      }
      block.replaceWith(container);
    }
    container.replaceChildren();
    lines.forEach((line, index) => {
      const element = content.ownerDocument.createElement("div");
      element.append(fragments[index]);
      if (!element.textContent && !element.querySelector("img, table, .template-token")) {
        element.append(content.ownerDocument.createElement("br"));
      }
      if (line.selected) applyLineAlignment(element, alignment);
      container.append(element);
    });
  }
  if (changed && snapshot) restoreTemplateTextSelection(content, snapshot);
  return changed;
}

export function bindTemplateLineAlignment({
  editor,
  surface,
  toolbar,
  commands,
}: {
  editor: TemplateEditorInstance;
  surface: HTMLElement;
  toolbar: HTMLElement;
  commands: TemplateEditorCommandDispatcher;
}) {
  const handleClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const command = target?.closest("[data-template-command]")?.getAttribute("data-template-command") || "";
    const alignment = ALIGNMENTS[command];
    if (!alignment) return;
    const activeSurface =
      surface.querySelector<HTMLElement>("[data-template-editor-runtime-active-surface='true']") || surface;
    if (activeSurface.querySelector(".is-selected-object, .is-selected-table-object, .is-selected-cell")) return;
    const content = activeSurface.querySelector<HTMLElement>(":scope > .template-doc") || activeSurface;
    const applied = commands.execute({
      id: "text.align-lines",
      mutate: () => alignTemplateTextLines(content, alignment),
    });
    if (!applied) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Modal drafts use the runtime's active-surface synchronization, while the
    // dispatcher also schedules the document transaction when appropriate.
    const snapshot = captureTemplateTextSelection(content);
    const runtime = editor.getRuntime();
    if (runtime.sync) runtime.sync({ preserveSelection: true, focusEditor: true });
    else editor.sync();
    activeSurface.focus({ preventScroll: true });
    const updatedContent = activeSurface.querySelector<HTMLElement>(":scope > .template-doc") || activeSurface;
    if (snapshot) restoreTemplateTextSelection(updatedContent, snapshot);
    commands.captureSelection();
  };
  toolbar.addEventListener("click", handleClick, true);
  return () => toolbar.removeEventListener("click", handleClick, true);
}
