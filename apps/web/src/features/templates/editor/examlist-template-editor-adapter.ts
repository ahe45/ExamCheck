import * as packageApi from "examlist-template-editor";
import type {
  DataTagAccordionGroup,
  DataTagDefinition,
  DataTagViewOptions,
  MountTemplateEditorOptions,
  TemplateEditorInstance,
  TemplateEditorValue,
} from "../../../shared/templates/template-editor-contracts";

export const templateEditorCompatibility = Object.freeze({
  packageName: "examlist-template-editor",
  packageVersion: "1.1.0",
  supportedMajorVersion: 1,
  minimumMinorVersion: 1,
  requiredFunctions: Object.freeze([
    "mountTemplateEditor",
    "normalizeDataTagViewOptions",
    "renderDataTagIcon",
    "formatDataTagSampleValue",
  ]),
  requiredValues: Object.freeze(["dataTagAccordionGroups"]),
});

type ExternalPackageApi = Record<string, unknown>;

interface ExternalMountedEditor {
  destroy(): void;
  getHtml(): string;
  getRuntime(): TemplateEditorInstance["getRuntime"] extends () => infer Runtime ? Runtime : never;
  getSelectedPageId(): string;
  getValue(): TemplateEditorValue;
  preview(context?: Record<string, unknown>): Promise<Record<string, unknown>>;
  save(context?: Record<string, unknown>): Promise<TemplateEditorValue | void>;
  sync(): TemplateEditorValue;
}

export interface TemplateEditorCompatibilityResult {
  compatible: boolean;
  issues: string[];
  packageVersion: string;
}

export interface ExamlistTemplateEditorAdapter {
  mount(options: MountTemplateEditorOptions): TemplateEditorInstance;
  normalizeViewOptions(options?: Partial<DataTagViewOptions> | null): DataTagViewOptions;
  renderDataTagIcon(iconKey?: string): string;
  formatDataTagSampleValue(
    definitionOrKey?: DataTagDefinition | string,
    value?: unknown,
    formatValue?: string,
    explicitFormatType?: string,
  ): string;
  getDataTagAccordionGroups(): readonly DataTagAccordionGroup[];
}

export function checkTemplateEditorCompatibility(
  api: ExternalPackageApi,
  packageVersion: string = templateEditorCompatibility.packageVersion,
): TemplateEditorCompatibilityResult {
  const issues: string[] = [];
  const versionMatch = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(packageVersion.trim());
  if (!versionMatch) {
    issues.push(`패키지 버전 형식이 올바르지 않습니다: ${packageVersion || "확인 불가"}`);
  } else {
    const major = Number(versionMatch[1]);
    const minor = Number(versionMatch[2]);
    if (
      major !== templateEditorCompatibility.supportedMajorVersion ||
      minor < templateEditorCompatibility.minimumMinorVersion
    ) {
      issues.push(
        `지원하지 않는 패키지 버전입니다: ${packageVersion} (지원 범위: ${templateEditorCompatibility.supportedMajorVersion}.${templateEditorCompatibility.minimumMinorVersion}.x 이상, 동일 주 버전)`,
      );
    }
  }

  for (const name of templateEditorCompatibility.requiredFunctions) {
    if (typeof api[name] !== "function") issues.push(`필수 함수 누락: ${name}`);
  }
  for (const name of templateEditorCompatibility.requiredValues) {
    if (!Array.isArray(api[name])) issues.push(`필수 데이터 누락: ${name}`);
  }

  return { compatible: issues.length === 0, issues, packageVersion };
}

export function assertTemplateEditorCompatibility(
  api: ExternalPackageApi,
  packageVersion: string = templateEditorCompatibility.packageVersion,
): void {
  const result = checkTemplateEditorCompatibility(api, packageVersion);
  if (result.compatible) return;
  throw new Error(
    `양식 편집기 패키지(${result.packageVersion})가 현재 시스템과 호환되지 않습니다. ${result.issues.join("; ")} 관리자에게 패키지 설치 상태를 확인해 달라고 요청해 주세요.`,
  );
}

export function createExamlistTemplateEditorAdapter(
  api: ExternalPackageApi,
  packageVersion: string = templateEditorCompatibility.packageVersion,
): ExamlistTemplateEditorAdapter {
  const ensureCompatible = () => assertTemplateEditorCompatibility(api, packageVersion);

  return {
    mount(options) {
      ensureCompatible();
      const mount = api.mountTemplateEditor as (mountOptions: MountTemplateEditorOptions) => unknown;
      const mounted = mount(options);
      assertMountedEditorCompatibility(mounted, packageVersion);
      const external = mounted as ExternalMountedEditor;
      let destroyed = false;
      return {
        destroy() {
          if (destroyed) return;
          destroyed = true;
          external.destroy();
        },
        getHtml: () => external.getHtml(),
        getRuntime: () => external.getRuntime(),
        getSelectedPageId: () => external.getSelectedPageId(),
        getValue: () => external.getValue(),
        preview: (context) => external.preview(context),
        save: (context) => external.save(context),
        sync: () => external.sync(),
      };
    },
    normalizeViewOptions(options) {
      ensureCompatible();
      const normalize = api.normalizeDataTagViewOptions as (
        value?: Partial<DataTagViewOptions> | null,
      ) => DataTagViewOptions;
      return normalize(options);
    },
    renderDataTagIcon(iconKey) {
      ensureCompatible();
      const render = api.renderDataTagIcon as (key?: string) => string;
      return render(iconKey);
    },
    formatDataTagSampleValue(definitionOrKey, value, formatValue, explicitFormatType) {
      ensureCompatible();
      const format = api.formatDataTagSampleValue as (
        definition?: DataTagDefinition | string,
        rawValue?: unknown,
        requestedFormat?: string,
        formatType?: string,
      ) => string;
      return format(definitionOrKey, value, formatValue, explicitFormatType);
    },
    getDataTagAccordionGroups() {
      ensureCompatible();
      return api.dataTagAccordionGroups as readonly DataTagAccordionGroup[];
    },
  };
}

function assertMountedEditorCompatibility(
  mounted: unknown,
  packageVersion: string,
): asserts mounted is ExternalMountedEditor {
  if (!mounted || typeof mounted !== "object") {
    throw new Error(
      `양식 편집기 패키지(${packageVersion})를 시작하지 못했습니다. 편집기 인스턴스가 생성되지 않았습니다.`,
    );
  }
  const api = mounted as Record<string, unknown>;
  const missing = [
    "destroy",
    "getHtml",
    "getRuntime",
    "getSelectedPageId",
    "getValue",
    "preview",
    "save",
    "sync",
  ].filter((name) => typeof api[name] !== "function");
  if (missing.length > 0) {
    throw new Error(
      `양식 편집기 패키지(${packageVersion})가 현재 시스템과 호환되지 않습니다. 편집기 필수 기능 누락: ${missing.join(", ")}. 관리자에게 패키지 설치 상태를 확인해 달라고 요청해 주세요.`,
    );
  }
}

const defaultAdapter = createExamlistTemplateEditorAdapter(
  packageApi as ExternalPackageApi,
  templateEditorCompatibility.packageVersion,
);

export const mountProjectTemplateEditor = defaultAdapter.mount;
export const normalizeProjectDataTagViewOptions = defaultAdapter.normalizeViewOptions;
export const renderProjectDataTagIcon = defaultAdapter.renderDataTagIcon;
export const formatProjectDataTagSampleValue = defaultAdapter.formatDataTagSampleValue;
export const getProjectDataTagAccordionGroups = defaultAdapter.getDataTagAccordionGroups;
