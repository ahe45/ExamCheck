import type { TemplateEditorValue } from "../../../shared/templates/template-editor-contracts";

const transientSelectors = [
  ".template-editor-image-selection",
  ".template-editor-image-resize-handle",
  ".examlist-object-selection",
  ".examlist-object-resize-handle",
  ".template-editor-table-selection",
  ".template-editor-table-handle",
  ".template-editor-table-move-handle",
  ".template-editor-table-select-handle",
  ".template-recognition-marks-overlay",
  "[data-template-object-flow-spacer]",
  "[data-candidate-block-focus-backdrop]",
  ".examlist-candidate-block-focus-backdrop",
  "[data-candidate-block-focus-layer]",
  ".examlist-candidate-block-focus-layer",
  "[data-candidate-block-grid-resize-handle]",
  "[data-candidate-block-grid-move-handle]",
].join(",");

const transientClassNames = [
  "template-editor-image-object",
  "is-active-cell",
  "is-hover-only",
  "is-floating-object",
  "is-moving-candidate-block-grid",
  "is-moving-object",
  "is-resizing",
  "is-resizing-candidate-block-grid",
  "is-resizing-object",
  "is-selected-candidate-block-grid",
  "is-selected-cell",
  "is-selected-object",
  "is-selected-table-object",
];

const transientAttributes = [
  "data-template-editor-runtime-active-surface",
  "data-template-editor-allow-overflow-sync",
  "data-candidate-block-modal-editor-surface",
  "data-template-object-flow-id",
  "draggable",
];

function looksLikeHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/iu.test(value);
}

export function serializeTemplateEditorHtml(html: string): string {
  const source = String(html || "");
  if (!source || !looksLikeHtml(source) || typeof DOMParser === "undefined") return source;
  const parsed = new DOMParser().parseFromString(`<body>${source}</body>`, "text/html");
  const root = parsed.body;

  root.querySelectorAll(transientSelectors).forEach((element) => element.remove());
  root.querySelectorAll<HTMLElement>("*").forEach((element) => {
    transientClassNames.forEach((className) => element.classList.remove(className));
    Array.from(element.classList).forEach((className) => {
      if (/^is-(?:image-)?(?:moving|resizing)(?:-|$)/u.test(className)) element.classList.remove(className);
    });
    transientAttributes.forEach((attribute) => element.removeAttribute(attribute));
    if (!element.classList.length) element.removeAttribute("class");
    if (element.getAttribute("contenteditable") === "true") element.removeAttribute("contenteditable");
  });

  return root.innerHTML;
}

function sanitizeValue(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    return /html$/iu.test(key) || looksLikeHtml(value) ? serializeTemplateEditorHtml(value) : value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeValue(entryValue, entryKey),
    ]),
  );
}

export function serializeTemplateEditorValue<T extends TemplateEditorValue>(value: T): T {
  return sanitizeValue(value) as T;
}
