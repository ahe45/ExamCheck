import type { DataTagCatalog, TemplateEditorValue } from "../templates/template-editor-contracts";
import { apiFetch } from "./client";

export type FormTemplateScope = "CANDIDATE" | "ROOM" | "EXAM";

export interface FormTemplate {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: string;
  usageScope: FormTemplateScope;
  layout: TemplateEditorValue;
  active: boolean;
  createdAt: string;
  createdByLoginId: string;
}

export interface SaveFormTemplateInput {
  code: string;
  name: string;
  description: string;
  category: string;
  usageScope: FormTemplateScope;
  layout: Exclude<TemplateEditorValue, string>;
  active: boolean;
}

export type FormTemplateSummary = Omit<FormTemplate, "layout">;

export function fetchFormTemplate(token: string, code: string, admin = false) {
  return apiFetch<FormTemplate>(`/form-templates/${admin ? "admin/" : ""}${encodeURIComponent(code)}`, {}, token);
}

export function fetchActiveFormTemplates(token: string) {
  return apiFetch<FormTemplateSummary[]>("/form-templates/summaries", {}, token);
}

export function fetchAdminFormTemplates(token: string) {
  return apiFetch<FormTemplateSummary[]>("/form-templates/admin/summaries", {}, token);
}

let tagCache: { token: string; expires: number; value: Promise<DataTagCatalog> } | null = null;
export function fetchFormTemplateDataTags(token: string) {
  if (tagCache?.token === token && tagCache.expires > Date.now()) return tagCache.value;
  const value = apiFetch<DataTagCatalog>("/form-templates/data-tags", {}, token).catch((error) => {
    if (tagCache?.value === value) tagCache = null;
    throw error;
  });
  tagCache = { token, expires: Date.now() + 5 * 60_000, value };
  return value;
}

export function saveFormTemplate(token: string, input: SaveFormTemplateInput) {
  return apiFetch<FormTemplate>(
    `/form-templates/${encodeURIComponent(input.code)}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function updateFormTemplateMetadata(
  token: string,
  code: string,
  input: Pick<SaveFormTemplateInput, "name" | "description">,
) {
  return apiFetch<FormTemplate>(
    `/form-templates/${encodeURIComponent(code)}/metadata`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function updateFormTemplateActive(token: string, code: string, active: boolean) {
  return apiFetch<FormTemplate>(
    `/form-templates/${encodeURIComponent(code)}/active`,
    {
      method: "PATCH",
      body: JSON.stringify({ active }),
    },
    token,
  );
}

export function deleteFormTemplate(token: string, code: string) {
  return apiFetch<void>(
    `/form-templates/${encodeURIComponent(code)}`,
    {
      method: "DELETE",
    },
    token,
  );
}
