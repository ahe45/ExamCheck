import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MountTemplateEditorOptions,
  TemplateEditorInstance,
  TemplateEditorValue,
} from "../../../shared/templates/template-editor-contracts";

const packageMock = vi.hoisted(() => ({
  destroy: vi.fn(),
  getHtml: vi.fn(() => "<p>양식</p>"),
  getRuntime: vi.fn(() => ({ setHtml: vi.fn() })),
  mountTemplateEditor: vi.fn(),
  preview: vi.fn(async () => ({ html: "<p>미리보기</p>" })),
  save: vi.fn(async () => ({ layout: { pages: [] } })),
}));

vi.mock("examlist-template-editor", () => ({
  dataTagAccordionGroups: [{ id: "candidate", label: "수험생", icon: "user", keys: ["candidate.name"] }],
  formatDataTagSampleValue: vi.fn((_definition, value) => String(value ?? "")),
  mountTemplateEditor: packageMock.mountTemplateEditor,
  normalizeDataTagViewOptions: vi.fn((options = {}) => ({
    showIcons: options.showIcons ?? true,
    showSampleData: options.showSampleData ?? false,
  })),
  renderDataTagIcon: vi.fn((icon = "more") => `<svg data-icon="${icon}"></svg>`),
}));

import {
  checkTemplateEditorCompatibility,
  createExamlistTemplateEditorAdapter,
  mountProjectTemplateEditor,
  templateEditorCompatibility,
} from "./examlist-template-editor-adapter";

function mountedPackageEditor() {
  return {
    destroy: packageMock.destroy,
    getHtml: packageMock.getHtml,
    getRuntime: packageMock.getRuntime,
    preview: packageMock.preview,
    save: packageMock.save,
  };
}

function mountOptions(overrides: Partial<MountTemplateEditorOptions> = {}): MountTemplateEditorOptions {
  return {
    root: {} as HTMLElement,
    template: { layout: { pages: [] } },
    dataTags: { tags: [] },
    ...overrides,
  };
}

function compatibleApi(overrides: Record<string, unknown> = {}) {
  return {
    dataTagAccordionGroups: [],
    formatDataTagSampleValue: vi.fn((_definition, value) => String(value ?? "")),
    mountTemplateEditor: vi.fn(() => mountedPackageEditor()),
    normalizeDataTagViewOptions: vi.fn(() => ({ showIcons: true, showSampleData: false })),
    renderDataTagIcon: vi.fn(() => "<svg></svg>"),
    ...overrides,
  };
}

describe("examlist template editor adapter contract", () => {
  beforeEach(() => {
    packageMock.mountTemplateEditor.mockReset();
    packageMock.mountTemplateEditor.mockReturnValue(mountedPackageEditor());
  });

  it("forwards editor callbacks and adapter callbacks without changing their contracts", () => {
    const onChange = vi.fn();
    const onDirtyChange = vi.fn();
    const onOverflowChange = vi.fn();
    const getTemplateEditorTagDisplay = vi.fn();
    const saveTemplate = vi.fn();
    const previewPdf = vi.fn();

    mountProjectTemplateEditor(
      mountOptions({
        getTemplateEditorTagDisplay,
        adapters: { saveTemplate, previewPdf },
        onChange,
        onDirtyChange,
        onOverflowChange,
      }),
    );

    const forwarded = packageMock.mountTemplateEditor.mock.calls[0]?.[0] as MountTemplateEditorOptions;
    expect(forwarded.onChange).toBe(onChange);
    expect(forwarded.onDirtyChange).toBe(onDirtyChange);
    expect(forwarded.onOverflowChange).toBe(onOverflowChange);
    expect(forwarded.getTemplateEditorTagDisplay).toBe(getTemplateEditorTagDisplay);
    expect(forwarded.adapters?.saveTemplate).toBe(saveTemplate);
    expect(forwarded.adapters?.previewPdf).toBe(previewPdf);
  });

  it("destroys the mounted package editor exactly once and preserves save/preview", async () => {
    const editor = mountProjectTemplateEditor(mountOptions());
    const saveContext = { reason: "contract-test" };
    const previewContext = { reason: "contract-test" };

    await expect(editor.save(saveContext)).resolves.toEqual({ layout: { pages: [] } });
    await expect(editor.preview(previewContext)).resolves.toEqual({ html: "<p>미리보기</p>" });
    expect(packageMock.save).toHaveBeenCalledWith(saveContext);
    expect(packageMock.preview).toHaveBeenCalledWith(previewContext);

    editor.destroy();
    editor.destroy();
    expect(packageMock.destroy).toHaveBeenCalledTimes(1);
  });

  it("exposes a testable package version and required API compatibility check", () => {
    expect(templateEditorCompatibility.packageVersion).toBe("1.1.0");
    expect(checkTemplateEditorCompatibility(compatibleApi(), "1.1.0")).toEqual({
      compatible: true,
      issues: [],
      packageVersion: "1.1.0",
    });
    expect(checkTemplateEditorCompatibility(compatibleApi(), "2.0.0")).toMatchObject({
      compatible: false,
      packageVersion: "2.0.0",
    });
  });

  it("throws a user-friendly error when a required package API is missing", () => {
    const adapter = createExamlistTemplateEditorAdapter(compatibleApi({ mountTemplateEditor: undefined }), "1.1.0");

    expect(() => adapter.mount(mountOptions())).toThrowError(
      /양식 편집기 패키지\(1\.1\.0\).*필수 함수 누락: mountTemplateEditor.*관리자/u,
    );
  });

  it("throws a user-friendly error when the mounted instance contract is incomplete", () => {
    const adapter = createExamlistTemplateEditorAdapter(
      compatibleApi({
        mountTemplateEditor: vi.fn(() => ({
          ...mountedPackageEditor(),
          save: undefined,
        })),
      }),
      "1.1.0",
    );

    expect(() => adapter.mount(mountOptions())).toThrowError(/편집기 필수 기능 누락: save/u);
  });
});

// Compile-time assertion: the public adapter exposes only the project contract.
const _projectOwnedContract: TemplateEditorInstance["save"] = async () =>
  ({ layout: { pages: [] } }) satisfies Exclude<TemplateEditorValue, string>;
void _projectOwnedContract;
