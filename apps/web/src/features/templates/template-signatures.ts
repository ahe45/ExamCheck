import type { TemplateEditorPage, TemplateEditorValue } from "../../shared/templates/template-editor-contracts";

export const templateSignatureFields = Object.freeze([
  Object.freeze({ key: "signature.author", label: "작성자" }),
  Object.freeze({ key: "signature.reviewer", label: "확인자" }),
]);

export type TemplateSignatureKey = (typeof templateSignatureFields)[number]["key"];
export type TemplateSignatureNames = Record<TemplateSignatureKey, string>;

export function emptyTemplateSignatureNames(): TemplateSignatureNames {
  return {
    "signature.author": "",
    "signature.reviewer": "",
  };
}

export function getTemplateSignatureNameInputEnabled(template: TemplateEditorValue): boolean {
  return getTemplatePages(template).some((page) => {
    const settings = page.settings?.signatureNames;
    return Boolean(settings && typeof settings === "object" && (settings as { enabled?: unknown }).enabled === true);
  });
}

export function getUsedTemplateSignatureFields(template: TemplateEditorValue) {
  const html = getTemplatePages(template)
    .map((page) => String(page.settings?.documentHtml || ""))
    .join("\n");
  return templateSignatureFields.filter((field) => templateHtmlUsesTag(html, field.key));
}

export function getRequiredTemplateSignatureFields(template: TemplateEditorValue) {
  return getTemplateSignatureNameInputEnabled(template) ? getUsedTemplateSignatureFields(template) : [];
}

export function writeTemplateSignatureNameInputEnabled(page: TemplateEditorPage, enabled: boolean) {
  page.settings = page.settings && typeof page.settings === "object" ? page.settings : {};
  page.settings.signatureNames = { enabled };
}

function getTemplatePages(template: TemplateEditorValue): TemplateEditorPage[] {
  if (!template || typeof template === "string") return [];
  const nestedPages = template.layout?.pages;
  const topLevelPages = (template as { pages?: TemplateEditorPage[] }).pages;
  if (Array.isArray(nestedPages)) return nestedPages;
  if (Array.isArray(topLevelPages)) return topLevelPages;
  return [{ settings: template.settings || { documentHtml: template.documentHtml || template.html || "" } }];
}

function templateHtmlUsesTag(html: string, key: TemplateSignatureKey) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:\\{\\{\\s*${escapedKey}\\s*\\}\\}|@\\{\\s*${escapedKey}\\s*\\}|data-template-tag-value\\s*=\\s*["'](?:@\\{\\s*)?${escapedKey}(?:\\s*\\})?["'])`,
    "i",
  ).test(html);
}
