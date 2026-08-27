import type { DataTagCatalog, TemplateEditorValue } from "../templates/template-editor-contracts";
import { apiFetch } from "./client";

export type FormTemplateScope = "CANDIDATE" | "ROOM" | "EXAM";

export interface FormTemplate {
  id: number;
  code: string;
  version: number;
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

export function fetchActiveFormTemplates(token: string) {
  return apiFetch<FormTemplate[]>("/form-templates", {}, token);
}

export function fetchAdminFormTemplates(token: string) {
  return apiFetch<FormTemplate[]>("/form-templates/admin", {}, token);
}

export function fetchFormTemplateDataTags(token: string) {
  return apiFetch<DataTagCatalog>("/form-templates/data-tags", {}, token);
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
