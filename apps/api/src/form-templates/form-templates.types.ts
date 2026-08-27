export type FormTemplateUsageScope = "CANDIDATE" | "ROOM" | "EXAM";

export interface SaveFormTemplateInput {
  code: string;
  name: string;
  description?: string;
  category: string;
  usageScope: FormTemplateUsageScope;
  layout: Record<string, unknown>;
  active?: boolean;
}

export interface UpdateFormTemplateMetadataInput {
  name: string;
  description?: string;
}
