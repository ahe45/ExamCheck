import type { DataTagCatalog } from "../templates/template-editor-contracts";
import { apiFetch } from "./client";

export type LabelElementKind = "text" | "barcode" | "line" | "box";

export interface LabelTemplateElement {
  id: string;
  kind: LabelElementKind;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  content?: string;
  fontSizeMm?: number;
  align?: "left" | "center" | "right";
  showText?: boolean;
  strokeWidthMm?: number;
}

export interface LabelTemplateLayout {
  widthMm: number;
  heightMm: number;
  dpi: 203 | 300;
  elements: LabelTemplateElement[];
  sampleData?: Record<string, string>;
}

export interface LabelTemplate {
  id: number;
  code: string;
  name: string;
  description: string | null;
  zplTemplate: string;
  layout: LabelTemplateLayout;
  active: boolean;
  createdAt: string;
  createdByLoginId: string;
}

export interface SaveLabelTemplateInput {
  code: string;
  name: string;
  description: string;
  layout: LabelTemplateLayout;
  active: boolean;
}

export function fetchLabelTemplates(token: string) {
  return apiFetch<{ dataTags: DataTagCatalog; templates: LabelTemplate[] }>("/label-templates", {}, token);
}

export function previewLabelTemplate(token: string, layout: LabelTemplateLayout) {
  return apiFetch<{ layout: LabelTemplateLayout; zplTemplate: string; samplePayload: string }>(
    "/label-templates/preview",
    { method: "POST", body: JSON.stringify({ layout }) },
    token,
  );
}

export function saveLabelTemplate(token: string, input: SaveLabelTemplateInput) {
  return apiFetch<LabelTemplate>(
    `/label-templates/${encodeURIComponent(input.code)}`,
    { method: "PUT", body: JSON.stringify(input) },
    token,
  );
}

export function updateLabelTemplateMetadata(
  token: string,
  code: string,
  input: Pick<SaveLabelTemplateInput, "name" | "description">,
) {
  return apiFetch<LabelTemplate>(
    `/label-templates/${encodeURIComponent(code)}/metadata`,
    { method: "PATCH", body: JSON.stringify(input) },
    token,
  );
}

export function updateLabelTemplateActive(token: string, code: string, active: boolean) {
  return apiFetch<LabelTemplate>(
    `/label-templates/${encodeURIComponent(code)}/active`,
    { method: "PATCH", body: JSON.stringify({ active }) },
    token,
  );
}

export function deleteLabelTemplate(token: string, code: string) {
  return apiFetch<void>(`/label-templates/${encodeURIComponent(code)}`, { method: "DELETE" }, token);
}
