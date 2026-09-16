import type { TemplateEditorDocument, TemplateEditorValue } from "../../../shared/templates/template-editor-contracts";

export function prepareTemplateEditorMount(template: TemplateEditorValue): TemplateEditorValue {
  const preparedTemplate = cloneTemplateValue(template);
  prepareSelectedPageCandidateBlocks(preparedTemplate);
  return preparedTemplate;
}

function cloneTemplateValue(template: TemplateEditorValue): TemplateEditorValue {
  if (typeof template === "string") return template;
  return typeof structuredClone === "function"
    ? structuredClone(template)
    : (JSON.parse(JSON.stringify(template)) as TemplateEditorDocument);
}

function prepareSelectedPageCandidateBlocks(template: TemplateEditorValue): void {
  const htmlTarget = getSelectedPageHtmlTarget(template);
  if (!htmlTarget || typeof DOMParser === "undefined") return;

  const parsed = new DOMParser().parseFromString(`<body>${htmlTarget.value}</body>`, "text/html");

  // Keep saved object positions during mount. Temporarily returning a grid to
  // normal flow makes the editor shift following tables before restoring the grid.
  const content = parsed.body.querySelector(".template-doc") || parsed.body;
  const trailingParagraphs: Element[] = [];
  let previous = content.lastElementChild;
  while (
    previous?.matches("p") &&
    previous.attributes.length === 0 &&
    Array.from(previous.childNodes).every((node) =>
      node.nodeType === Node.TEXT_NODE
        ? !node.textContent?.trim()
        : node.nodeType === Node.ELEMENT_NODE && (node as Element).matches("br"),
    )
  ) {
    trailingParagraphs.unshift(previous);
    previous = previous.previousElementSibling;
  }
  // Older resize sessions inserted a paragraph on every pointer move. Keep
  // one place to type after the block, without retaining the accidental tail.
  if (previous?.matches("[data-candidate-block-grid]")) {
    trailingParagraphs.slice(1).forEach((paragraph) => paragraph.remove());
  }
  htmlTarget.set(parsed.body.innerHTML);
}

function getSelectedPageHtmlTarget(template: TemplateEditorValue): { set(value: string): void; value: string } | null {
  if (typeof template === "string") return null;
  const selectedPage = template.layout?.pages?.[0];
  if (typeof selectedPage?.settings?.documentHtml === "string") {
    return {
      value: selectedPage.settings.documentHtml,
      set(value) {
        selectedPage.settings!.documentHtml = value;
      },
    };
  }
  if (typeof template.settings?.documentHtml === "string") {
    return {
      value: template.settings.documentHtml,
      set(value) {
        template.settings!.documentHtml = value;
      },
    };
  }
  if (typeof template.documentHtml === "string") {
    return {
      value: template.documentHtml,
      set(value) {
        template.documentHtml = value;
      },
    };
  }
  return null;
}
