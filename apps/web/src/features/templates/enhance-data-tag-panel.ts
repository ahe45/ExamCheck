import {
  type DataTagCatalog,
  type DataTagDefinition,
  type DataTagGroup,
  type DataTagViewOptions,
  type TemplateEditorInstance,
} from "../../shared/templates/template-editor-contracts";
import {
  getProjectDataTagAccordionGroups,
  normalizeProjectDataTagViewOptions,
  renderProjectDataTagIcon,
} from "./editor/examlist-template-editor-adapter";
import type { TemplateEditorCommandDispatcher } from "./editor/template-editor-command-dispatcher";

const STORAGE_KEY = "examcheck.templateEditor.dataTagViewOptions";
const CATALOG_GROUP_ICONS: Record<string, string> = {
  system: "school",
  exam: "book",
  candidate: "user",
  site: "building",
  option: "more",
  room: "building",
  signature: "user",
  etc: "more",
};

interface ProjectDataTagGroup {
  id: string;
  label: string;
  icon: string;
  keys: readonly string[];
  tags: DataTagDefinition[];
}

export function readDataTagViewOptions(): DataTagViewOptions {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    return normalizeProjectDataTagViewOptions(stored);
  } catch {
    return normalizeProjectDataTagViewOptions();
  }
}

export function enhanceDataTagPanel({
  root,
  catalog,
  editor,
  viewOptions,
  onViewOptionsChange,
  onOpenSettings,
  commandDispatcher,
}: {
  root: HTMLElement;
  catalog: DataTagCatalog;
  editor: TemplateEditorInstance;
  viewOptions: DataTagViewOptions;
  onViewOptionsChange(options: DataTagViewOptions): void;
  onOpenSettings(): void;
  commandDispatcher?: TemplateEditorCommandDispatcher;
}) {
  const panel = root.querySelector<HTMLElement>("[data-template-editor-runtime-tag-panel]");
  const tagHost = root.querySelector<HTMLElement>("[data-template-editor-runtime-tags]");
  if (!panel || !tagHost) return () => undefined;

  const groups = groupDataTags(catalog);
  panel.setAttribute("aria-label", "데이터 태그");
  panel.innerHTML = `
    <div class="editor-tag-panel-block">
      <div class="template-tag-panel-heading">
        <p class="template-tag-caption">데이터 태그</p>
        <button class="icon-button template-tag-sample-settings-button" type="button" title="데이터 태그 설정" aria-label="데이터 태그 설정">
          <svg class="button-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"></path>
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.36a1.7 1.7 0 0 0-1 .24 1.7 1.7 0 0 0-.82 1.46V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.36 19.45 1.7 1.7 0 0 0 7 19.2a1.7 1.7 0 0 0-.87.52l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3.64 15a1.7 1.7 0 0 0-.24-1 1.7 1.7 0 0 0-1.46-.82H2a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 3.55 8.36 1.7 1.7 0 0 0 3.8 7a1.7 1.7 0 0 0-.52-.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8 3.64a1.7 1.7 0 0 0 1-.24 1.7 1.7 0 0 0 .82-1.46V2a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 14.64 3.55 1.7 1.7 0 0 0 16 3.8a1.7 1.7 0 0 0 .87-.52l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.36 8c.09.35.09.7 0 1a1.7 1.7 0 0 0 1.46.82H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.45 14.64c-.02.12-.04.24-.05.36Z"></path>
          </svg>
        </button>
      </div>
      <div class="template-tag-strip editor-tag-catalog" data-template-editor-runtime-tags>
        <label class="template-tag-search">
          <span class="template-tag-search-icon" aria-hidden="true"></span>
          <input data-template-tag-search type="search" placeholder="태그 검색..." autocomplete="off" />
        </label>
        <div class="template-tag-view-options" aria-label="캔버스 데이터태그 표시 옵션">
          ${renderSwitch("showIcons", "아이콘 표시", viewOptions.showIcons)}
          ${renderSwitch("showSampleData", "샘플데이터로 표시", viewOptions.showSampleData)}
        </div>
        <div class="template-tag-accordion" data-template-tag-accordion>
          ${groups.map(renderGroup).join("")}
        </div>
        <p class="editor-empty template-tag-search-empty" data-template-tag-search-empty hidden>검색 결과가 없습니다.</p>
      </div>
    </div>
  `;

  const enhancedHost = panel.querySelector<HTMLElement>("[data-template-editor-runtime-tags]");
  const search = panel.querySelector<HTMLInputElement>("[data-template-tag-search]");
  const settingsButton = panel.querySelector<HTMLButtonElement>(".template-tag-sample-settings-button");
  const switches = Array.from(panel.querySelectorAll<HTMLInputElement>("[data-template-tag-view-option]"));
  let currentOptions = viewOptions;

  const applySearch = () => filterTagPanel(enhancedHost, search?.value || "");
  const updateSwitch = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const next = normalizeProjectDataTagViewOptions({
      ...currentOptions,
      [input.dataset.templateTagViewOption || ""]: input.checked,
    });
    currentOptions = next;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    onViewOptionsChange(next);
    const runtime = editor.getRuntime();
    runtime.setHtml(editor.getHtml(), { notify: false, resetHistory: false });
  };
  const openSettings = () => onOpenSettings();
  const insertTag = (event: MouseEvent) => {
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>(".template-tag-button[data-template-tag]")
        : null;
    if (!button || !enhancedHost?.contains(button) || !commandDispatcher) return;
    const tag = String(button.dataset.templateTag || "").trim();
    if (!tag) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    commandDispatcher.execute({
      id: "data-tag.insert",
      mutate: () => {
        const runtime = editor.getRuntime();
        if (typeof runtime.insertTag !== "function") return false;
        runtime.insertTag(tag);
        return true;
      },
    });
  };

  search?.addEventListener("input", applySearch);
  settingsButton?.addEventListener("click", openSettings);
  switches.forEach((input) => input.addEventListener("change", updateSwitch));
  enhancedHost?.addEventListener("click", insertTag);
  applySearch();

  return () => {
    search?.removeEventListener("input", applySearch);
    settingsButton?.removeEventListener("click", openSettings);
    switches.forEach((input) => input.removeEventListener("change", updateSwitch));
    enhancedHost?.removeEventListener("click", insertTag);
  };
}

export function decorateCatalog(catalog: DataTagCatalog): DataTagCatalog {
  const decorateTag = (tag: DataTagDefinition, groupIcon?: string) => {
    const key = String(tag.key || tag.dataKey || "").trim();
    const label = String(tag.label || key).trim();
    const groupDefinition = getProjectDataTagAccordionGroups().find((item) => item.keys.includes(key));
    return {
      ...tag,
      aliases: Array.from(new Set([label, key, ...(Array.isArray(tag.aliases) ? tag.aliases : [])].filter(Boolean))),
      // The editor stores `token` in data-template-tag-value. Keep that value as
      // the canonical system key so previews and PDF output can resolve it.
      token: key || String(tag.token || ""),
      editorToken: `#${label}`,
      iconMarkup: renderProjectDataTagIcon(groupIcon || groupDefinition?.icon || "more"),
    };
  };
  return {
    ...catalog,
    tags: catalog.tags?.map((tag) => decorateTag(tag)),
    groups: catalog.groups?.map((group, index) => {
      const id = catalogGroupId(group, index);
      const icon = CATALOG_GROUP_ICONS[id] || "more";
      return {
        ...group,
        icon,
        tags: group.tags?.map((tag) => decorateTag(tag, icon)),
      };
    }),
  };
}

function flattenTags(catalog: DataTagCatalog): DataTagDefinition[] {
  return [
    ...(Array.isArray(catalog.tags) ? catalog.tags : []),
    ...(Array.isArray(catalog.groups)
      ? catalog.groups.flatMap((group) => (Array.isArray(group.tags) ? group.tags : []))
      : []),
  ];
}

export function groupDataTags(source: DataTagCatalog | DataTagDefinition[]): ProjectDataTagGroup[] {
  if (!Array.isArray(source) && Array.isArray(source.groups) && source.groups.length > 0) {
    const groups = source.groups.map((group, index) => {
      const id = catalogGroupId(group, index);
      const tags = Array.isArray(group.tags) ? group.tags : [];
      return {
        id,
        label: String(group.label || "기타"),
        icon: String(group.icon || CATALOG_GROUP_ICONS[id] || "more"),
        keys: tags.map((tag) => String(tag.key || tag.dataKey || "")).filter(Boolean),
        tags,
      };
    });
    const ungrouped = Array.isArray(source.tags) ? source.tags : [];
    if (ungrouped.length > 0) {
      const etc = groups.find((group) => group.id === "etc");
      if (etc) {
        etc.tags = [...etc.tags, ...ungrouped];
        etc.keys = etc.tags.map((tag) => String(tag.key || tag.dataKey || "")).filter(Boolean);
      } else {
        groups.push({
          id: "etc",
          label: "기타",
          icon: "more",
          keys: ungrouped.map((tag) => String(tag.key || tag.dataKey || "")).filter(Boolean),
          tags: ungrouped,
        });
      }
    }
    return groups.filter((group) => group.tags.length > 0);
  }

  const definitions = Array.isArray(source) ? source : flattenTags(source);
  const tagMap = new Map(definitions.map((tag) => [String(tag.key || "").trim(), tag]));
  const used = new Set<string>();
  const groups: ProjectDataTagGroup[] = getProjectDataTagAccordionGroups().map((group) => {
    const tags = group.keys.map((key) => tagMap.get(key)).filter((tag): tag is DataTagDefinition => Boolean(tag));
    tags.forEach((tag) => used.add(String(tag.key || "")));
    return { ...group, tags };
  });
  const remaining = definitions.filter((tag) => !used.has(String(tag.key || "")));
  const etc = groups.find((group) => group.id === "etc");
  if (etc) etc.tags = [...etc.tags, ...remaining];
  return groups.filter((group) => group.tags.length > 0);
}

function catalogGroupId(group: DataTagGroup, index: number) {
  return String(group?.id || group?.key || `group-${index}`);
}

function renderSwitch(key: keyof DataTagViewOptions, label: string, checked: boolean) {
  return `<label class="template-tag-view-switch">
    <input data-template-tag-view-option="${key}" ${checked ? "checked" : ""} type="checkbox" />
    <span class="template-tag-view-switch-track" aria-hidden="true"></span>
    <span class="template-tag-view-switch-label">${label}</span>
  </label>`;
}

function renderGroup(group: ReturnType<typeof groupDataTags>[number]) {
  return `<details class="template-tag-accordion-group">
    <summary class="template-tag-accordion-summary">
      <span class="template-tag-group-heading">
        <span class="template-tag-group-icon">${renderProjectDataTagIcon(group.icon)}</span>
        <span class="template-tag-group-label">${escapeMarkup(group.label)}</span>
        <span class="template-tag-group-count" data-template-tag-group-count>${group.tags.length}</span>
      </span>
      <span class="template-tag-group-chevron" aria-hidden="true"></span>
    </summary>
    <div class="template-tag-accordion-list">
      ${group.tags.map((tag) => renderTagButton(tag, group.label, group.icon)).join("")}
    </div>
  </details>`;
}

function renderTagButton(tag: DataTagDefinition, groupLabel: string, icon: string) {
  const label = String(tag.label || tag.key || "").trim();
  const editorToken = String(tag.editorToken || tag.token || `#${label}`).trim();
  const example = String(tag.example || "").trim();
  const aliases = Array.isArray(tag.aliases) ? tag.aliases : [];
  const search = [groupLabel, tag.key, tag.token, tag.dataKey, editorToken, label, example, ...aliases]
    .join(" ")
    .toLowerCase();
  const title = [label, example].filter(Boolean).join(" · ");
  return `<button class="template-tag-button template-tag-accordion-button" data-template-tag="${escapeMarkup(editorToken)}" data-template-tag-search="${escapeMarkup(search)}" type="button" title="${escapeMarkup(title || editorToken)}" aria-label="${escapeMarkup(title || editorToken)}">
    <span class="template-tag-button-icon">${renderProjectDataTagIcon(icon)}</span>
    <span class="template-tag-button-label">${escapeMarkup(label || editorToken)}</span>
  </button>`;
}

function filterTagPanel(host: HTMLElement | null, term: string) {
  if (!host) return;
  const normalized = term.trim().toLowerCase();
  let visible = 0;
  host.querySelectorAll<HTMLDetailsElement>(".template-tag-accordion-group").forEach((group) => {
    let count = 0;
    group.querySelectorAll<HTMLButtonElement>(".template-tag-button").forEach((button) => {
      const matched = !normalized || String(button.dataset.templateTagSearch || "").includes(normalized);
      button.hidden = !matched;
      if (matched) {
        count += 1;
        visible += 1;
      }
    });
    group.hidden = count === 0;
    const counter = group.querySelector<HTMLElement>("[data-template-tag-group-count]");
    if (counter) counter.textContent = String(count);
    if (normalized && count > 0) group.open = true;
  });
  const empty = host.querySelector<HTMLElement>("[data-template-tag-search-empty]");
  if (empty) empty.hidden = visible > 0;
}

function escapeMarkup(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] || character,
  );
}
