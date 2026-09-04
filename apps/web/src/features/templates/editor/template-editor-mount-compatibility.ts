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

  parsed.body.querySelectorAll<HTMLElement>("[data-candidate-block-grid]").forEach((grid) => {
    if (grid.style.position !== "absolute") return;
    grid.style.position = "relative";
    grid.style.top = "";
  });
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
