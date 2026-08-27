import type { FormTemplate, FormTemplateScope } from "../../shared/api/form-templates";
import type {
  DataTagCatalog,
  DataTagDefinition,
  TemplateEditorValue,
} from "../../shared/templates/template-editor-contracts";

export interface DraftTemplate {
  code: string;
  name: string;
  description: string;
  category: string;
  usageScope: FormTemplateScope;
  layout: Exclude<TemplateEditorValue, string>;
  active: boolean;
  version: number;
}

export type TemplateMetadataField = "name" | "description";

export interface CardMetadataEdit {
  templateId: number;
  field: TemplateMetadataField;
  value: string;
}

export interface CardMetadataUpdate {
  name: string;
  description: string;
}

export function groupTemplatesByCategory(templates: readonly FormTemplate[]) {
  return templates.reduce<Record<string, FormTemplate[]>>((groups, template) => {
    (groups[template.category] ||= []).push(template);
    return groups;
  }, {});
}

export function createCardMetadataEdit(template: FormTemplate, field: TemplateMetadataField): CardMetadataEdit {
  return {
    templateId: template.id,
    field,
    value: field === "name" ? template.name : template.description || "",
  };
}

export function buildCardMetadataUpdate(template: FormTemplate, edit: CardMetadataEdit): CardMetadataUpdate {
  const value = edit.value.trim();
  if (edit.templateId !== template.id) {
    throw new Error("수정 중인 양식 정보가 일치하지 않습니다.");
  }
  if (edit.field === "name" && !value) {
    throw new Error("양식 제목을 입력해 주세요.");
  }
  return {
    name: edit.field === "name" ? value : template.name,
    description: edit.field === "description" ? value : template.description || "",
  };
}

export function updateDraftMetadata<K extends keyof DraftTemplate>(
  draft: DraftTemplate,
  key: K,
  value: DraftTemplate[K],
): DraftTemplate {
  return { ...draft, [key]: value };
}

export function createDraftMetadataSnapshot(draft: DraftTemplate) {
  return JSON.stringify({
    active: draft.active,
    category: draft.category,
    code: draft.code,
    description: draft.description,
    name: draft.name,
    usageScope: draft.usageScope,
  });
}

export function isDraftMetadataDirty(draft: DraftTemplate, snapshot: string) {
  return createDraftMetadataSnapshot(draft) !== snapshot;
}

export function toDraft(template?: FormTemplate): DraftTemplate | null {
  if (!template || typeof template.layout === "string") return null;
  return {
    code: template.code,
    name: template.name,
    description: template.description || "",
    category: template.category,
    usageScope: template.usageScope,
    layout: template.layout,
    active: template.active,
    version: template.version,
  };
}

export function createBlankDraft(now = Date.now()): DraftTemplate {
  const pageId = `page-${now}`;
  return {
    code: "NEW_FORM",
    name: "새 양식",
    description: "",
    category: "기타",
    usageScope: "CANDIDATE",
    active: true,
    version: 0,
    layout: {
      id: `template-${now}`,
      name: "새 양식",
      layout: {
        pages: [
          {
            id: pageId,
            type: "content",
            settings: { documentHtml: "<p><br></p>" },
          },
        ],
      },
    },
  };
}

export function validateDraft(draft: DraftTemplate) {
  if (!/^[A-Z0-9_]{2,100}$/.test(draft.code)) {
    throw new Error("양식 코드는 영문 대문자, 숫자, 밑줄로 입력해 주세요.");
  }
  if (!draft.name.trim()) throw new Error("양식명을 입력해 주세요.");
  if (!draft.category.trim()) throw new Error("양식 분류를 입력해 주세요.");
}

export function scopeLabel(scope: FormTemplateScope) {
  if (scope === "ROOM") return "고사실별";
  if (scope === "EXAM") return "시험 전체";
  return "수험생별";
}

export function updateTagExamples(catalog: DataTagCatalog, examples: Record<string, string>): DataTagCatalog {
  const update = (tag: DataTagDefinition) => ({
    ...tag,
    example: examples[String(tag.key || "")] ?? tag.example,
  });
  return {
    ...catalog,
    tags: catalog.tags?.map(update),
    groups: catalog.groups?.map((group) => ({
      ...group,
      tags: group.tags?.map(update),
    })),
  };
}

export function getTemplateSampleData(template: DraftTemplate["layout"]): Record<string, string> {
  const layout = template.layout as Record<string, unknown> | undefined;
  const settings = layout?.dataTagSettings as Record<string, unknown> | undefined;
  const sampleData = settings?.sampleData;
  if (!sampleData || typeof sampleData !== "object" || Array.isArray(sampleData)) return {};
  return Object.fromEntries(Object.entries(sampleData).map(([key, value]) => [key, String(value ?? "")]));
}

export function updateTemplateSampleData(
  template: DraftTemplate["layout"],
  examples: Record<string, string>,
): DraftTemplate["layout"] {
  const layout = (template.layout || {}) as Record<string, unknown>;
  const settings = (layout.dataTagSettings || {}) as Record<string, unknown>;
  return {
    ...template,
    layout: {
      ...layout,
      dataTagSettings: { ...settings, sampleData: examples },
    },
  } as DraftTemplate["layout"];
}

export function buildSampleValues(dataTags: DataTagCatalog) {
  const tags = [
    ...(Array.isArray(dataTags.tags) ? dataTags.tags : []),
    ...(Array.isArray(dataTags.groups)
      ? dataTags.groups.flatMap((group) => (Array.isArray(group.tags) ? group.tags : []))
      : []),
  ];
  return Object.fromEntries(
    tags.map((tag) => [String(tag.key || tag.dataKey || tag.token || ""), tag.example ?? ""]).filter(([key]) => key),
  );
}
