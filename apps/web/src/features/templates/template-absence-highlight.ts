import type { TemplateEditorPageSettings } from "../../shared/templates/template-editor-contracts";
import { normalizeTemplateDataTagKey } from "./template-data-projection";

export const defaultAbsenceHighlightColor = "#e2e8f0";

export function absenceHighlightSettings(settings?: TemplateEditorPageSettings) {
  const value = settings?.absenceHighlight as { enabled?: unknown; color?: unknown } | undefined;
  return {
    enabled: value?.enabled === true,
    color:
      typeof value?.color === "string" && /^#[0-9a-f]{6}$/i.test(value.color)
        ? value.color
        : defaultAbsenceHighlightColor,
  };
}

export function absenceTableTags(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>("[data-template-tag-value]")].filter(
    (tag) =>
      normalizeTemplateDataTagKey(tag.dataset.templateTagValue || "") === "candidate.absent" &&
      Boolean(tag.closest("td, th")) &&
      !tag.closest("[data-candidate-block-modal-editor-surface], [data-candidate-block-focus-layer]"),
  );
}

export function isAbsentValue(value: unknown) {
  return value === true || String(value).trim() === "결시" || String(value).trim() === "true";
}

export function applyAbsenceRowHighlight(
  root: HTMLElement,
  settings?: TemplateEditorPageSettings,
  absent: (tag: HTMLElement) => boolean = (tag) => isAbsentValue(tag.textContent),
) {
  const config = absenceHighlightSettings(settings);
  if (!config.enabled) return;
  for (const tag of absenceTableTags(root)) {
    if (!absent(tag)) continue;
    const row = tag.closest("tr");
    if (!row || !root.contains(row)) continue;
    row.style.setProperty("background-color", config.color, "important");
    for (const cell of row.cells) cell.style.setProperty("background-color", config.color, "important");
  }
}
