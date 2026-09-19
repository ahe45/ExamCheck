/**
 * Project-owned boundary types for the external template editor.
 *
 * Keep these types limited to the capabilities ExamCheck consumes so package
 * upgrades cannot leak their full public API through the application.
 */
export interface TemplateEditorPageSettings {
  documentHtml?: string;
  orientation?: string;
  [key: string]: unknown;
}

export interface TemplateEditorPage {
  id?: string;
  type?: string;
  settings?: TemplateEditorPageSettings;
  [key: string]: unknown;
}

export interface TemplateEditorLayout {
  pages?: TemplateEditorPage[];
  [key: string]: unknown;
}

export interface TemplateEditorDocument {
  documentHtml?: string;
  html?: string;
  orientation?: string;
  settings?: TemplateEditorPageSettings;
  layout?: TemplateEditorLayout;
  [key: string]: unknown;
}

export type TemplateEditorValue = TemplateEditorDocument | string;

export interface DataTagDefinition {
  key?: string;
  dataKey?: string;
  token?: string;
  label?: string;
  type?: string;
  example?: unknown;
  [key: string]: unknown;
}

export interface DataTagGroup {
  id?: string;
  label?: string;
  tags?: DataTagDefinition[];
  [key: string]: unknown;
}

export interface DataTagCatalog {
  groups?: DataTagGroup[];
  tags?: DataTagDefinition[];
  [key: string]: unknown;
}

export interface DataTagViewOptions {
  showIcons: boolean;
  showSampleData: boolean;
}

export interface DataTagAccordionGroup {
  id: string;
  label: string;
  icon: string;
  keys: readonly string[];
  [key: string]: unknown;
}

export interface TemplateEditorOverflowInfo {
  hasOverflow: boolean;
  [key: string]: unknown;
}

export interface TemplateEditorRuntime {
  insertHtml?(html: string): unknown;
  insertTag?(tag: string): unknown;
  sync?(options?: { preserveSelection?: boolean; focusEditor?: boolean }): unknown;
  setHtml(html: string, options?: { notify?: boolean; resetHistory?: boolean }): unknown;
}

export interface TemplateEditorInstance {
  destroy(): void;
  getHtml(): string;
  getRuntime(): TemplateEditorRuntime;
  getSelectedPageId(): string;
  getValue(): TemplateEditorValue;
  preview(context?: Record<string, unknown>): Promise<Record<string, unknown>>;
  save(context?: Record<string, unknown>): Promise<TemplateEditorValue | void>;
  sync(): TemplateEditorValue;
}

export interface TemplateEditorTagDisplayContext {
  formatValue?: string;
  formatType?: string;
  definition: Readonly<DataTagDefinition> | null;
  iconMarkup: string;
  label: string;
  tag: string;
}

export interface TemplateEditorTagDisplay {
  hideIcons?: boolean;
  iconMarkup?: string;
  sampleDisplay?: boolean;
  text?: string;
  title?: string;
}

export interface TemplateEditorSaveContext extends Record<string, unknown> {
  editor: TemplateEditorInstance | null;
  html: string;
  template: TemplateEditorValue;
}

export interface TemplateEditorPreviewContext extends Record<string, unknown> {
  editor: TemplateEditorInstance | null;
  html: string;
  sampleData: Record<string, unknown>;
  template: TemplateEditorValue;
}

export interface MountTemplateEditorOptions {
  root: HTMLElement;
  template: TemplateEditorValue;
  dataTags: DataTagCatalog | DataTagDefinition[];
  layoutMode?: "desktop" | "responsive";
  permissions?: { canManageTemplates?: boolean; [key: string]: unknown };
  generatedObjectSourceKey?: string;
  previewData?: Record<string, unknown>;
  getTemplateEditorTagDisplay?(context: TemplateEditorTagDisplayContext): TemplateEditorTagDisplay | null | void;
  adapters?: {
    buildApiUrl?(path: string): string;
    saveTemplate?(context: TemplateEditorSaveContext): Promise<TemplateEditorValue | void> | TemplateEditorValue | void;
    previewPdf?(context: TemplateEditorPreviewContext): Promise<Record<string, unknown>> | Record<string, unknown>;
  };
  onChange?(nextTemplate: TemplateEditorValue, context: Record<string, unknown>): void;
  onDirtyChange?(isDirty: boolean): void;
  onOverflowChange?(info: TemplateEditorOverflowInfo, message: string): void;
}
