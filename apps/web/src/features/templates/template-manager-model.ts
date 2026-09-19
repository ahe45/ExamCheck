import type {
  FormTemplateSummary,
  FormTemplate,
  FormTemplateScope,
  SaveFormTemplateInput,
} from "../../shared/api/form-templates";
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
  isNew: boolean;
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

export function groupTemplatesByCategory(templates: readonly FormTemplateSummary[]) {
  return templates.reduce<Record<string, FormTemplateSummary[]>>((groups, template) => {
    (groups[template.category] ||= []).push(template);
    return groups;
  }, {});
}

export function createCardMetadataEdit(template: FormTemplateSummary, field: TemplateMetadataField): CardMetadataEdit {
  return {
    templateId: template.id,
    field,
    value: field === "name" ? template.name : template.description || "",
  };
}

export function buildCardMetadataUpdate(template: FormTemplateSummary, edit: CardMetadataEdit): CardMetadataUpdate {
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

export function buildTemplateActiveUpdate(template: FormTemplate, active: boolean): SaveFormTemplateInput {
  return buildTemplateSaveInput(template, {
    active,
    code: template.code,
    name: template.name,
  });
}

export function buildTemplateCopyInput(
  template: FormTemplate,
  templates: readonly FormTemplateSummary[],
): SaveFormTemplateInput {
  const existingCodes = new Set(templates.map((item) => item.code));
  const existingNames = new Set(templates.map((item) => item.name));
  return buildTemplateSaveInput(template, {
    active: false,
    code: createUniqueCopyCode(template.code, existingCodes),
    name: createUniqueCopyName(template.name, existingNames),
  });
}

function buildTemplateSaveInput(
  template: FormTemplate,
  overrides: Pick<SaveFormTemplateInput, "active" | "code" | "name">,
): SaveFormTemplateInput {
  if (typeof template.layout === "string") {
    throw new Error("복사하거나 변경할 수 없는 양식 형식입니다.");
  }
  return {
    ...overrides,
    description: template.description || "",
    category: template.category,
    usageScope: template.usageScope,
    layout: template.layout,
  };
}

function createUniqueCopyCode(sourceCode: string, existingCodes: ReadonlySet<string>) {
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? "_COPY" : `_COPY_${index}`;
    const code = `${sourceCode.slice(0, 100 - suffix.length)}${suffix}`;
    if (!existingCodes.has(code)) return code;
  }
  throw new Error("복사본 양식 코드를 만들 수 없습니다.");
}

function createUniqueCopyName(sourceName: string, existingNames: ReadonlySet<string>) {
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? " 복사본" : ` 복사본 ${index}`;
    const name = `${sourceName.slice(0, 200 - suffix.length)}${suffix}`;
    if (!existingNames.has(name)) return name;
  }
  throw new Error("복사본 양식명을 만들 수 없습니다.");
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
    isNew: false,
  };
}

export function createBlankDraft(now = Date.now(), existingCodes: Iterable<string> = []): DraftTemplate {
  const pageId = `page-${now}`;
  return {
    code: createUniqueTemplateCode(now, existingCodes),
    name: "",
    description: "",
    category: "기타",
    usageScope: "CANDIDATE",
    active: true,
    isNew: true,
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

function createUniqueTemplateCode(now: number, existingCodes: Iterable<string>) {
  const usedCodes = new Set(Array.from(existingCodes, (code) => code.trim().toUpperCase()));
  const timestamp = Math.max(0, Math.trunc(now)).toString(36).toUpperCase();
  const baseCode = `FORM_${timestamp}`;

  if (!usedCodes.has(baseCode)) return baseCode;
  for (let index = 2; index < 10_000; index += 1) {
    const suffix = `_${index}`;
    const code = `${baseCode.slice(0, 100 - suffix.length)}${suffix}`;
    if (!usedCodes.has(code)) return code;
  }
  throw new Error("새 양식 코드를 자동으로 만들 수 없습니다.");
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
