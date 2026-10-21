import type { TemplateEditorPage } from "../../shared/templates/template-editor-contracts";
import { absenceHighlightSettings, absenceTableTags } from "./template-absence-highlight";

export function bindAbsenceHighlightControls({
  pagePropertiesHost,
  selectedPage,
  getCurrentPage,
  surfaceElement,
  onDirty,
}: {
  pagePropertiesHost: HTMLElement;
  selectedPage: TemplateEditorPage;
  getCurrentPage(): TemplateEditorPage | null;
  surfaceElement: HTMLElement;
  onDirty(): void;
}) {
  pagePropertiesHost.querySelector(".examcheck-absence-highlight-field")?.remove();
  const section = pagePropertiesHost.ownerDocument.createElement("section");
  section.className = "template-page-property-field examcheck-absence-highlight-field";
  section.innerHTML = `
    <div class="examlist-page-number-header">
      <span>결시 강조</span>
      <div class="examcheck-absence-highlight-actions">
        <button type="button" class="examcheck-absence-color-trigger" aria-label="결시 음영 색상 설정" aria-expanded="false" aria-haspopup="dialog">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 3-1 3-3 1-2 4 2 2v4l4 3 3-1 3 1 4-3v-4l2-2-2-4-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <label class="examlist-switch-control">
          <input class="sr-only" data-examcheck-absence-highlight="enabled" type="checkbox" aria-label="결시 강조 사용" />
          <span class="examlist-switch-track" aria-hidden="true"><span></span></span>
        </label>
      </div>
    </div>
    <div class="examcheck-absence-color-popover" role="dialog" aria-label="결시 음영 색상" hidden>
      <strong>결시 행 음영 색상</strong>
      <div class="examcheck-absence-color-palette">
        ${[
          ["#e2e8f0", "회색"],
          ["#cbd5e1", "진한 회색"],
          ["#dbeafe", "파란색"],
          ["#dcfce7", "초록색"],
          ["#fef3c7", "노란색"],
          ["#ffedd5", "주황색"],
          ["#fee2e2", "빨간색"],
          ["#ede9fe", "보라색"],
        ]
          .map(
            ([color, label]) =>
              `<button type="button" data-absence-color="${color}" aria-label="${label}" style="background:${color}"></button>`,
          )
          .join("")}
      </div>
      <label class="examcheck-absence-custom-color">직접 선택 <input type="color" aria-label="결시 음영 사용자 색상" /></label>
    </div>
    <style data-absence-preview-style></style>
  `;
  const signature = pagePropertiesHost.querySelector(".examcheck-signature-name-field");
  if (signature) signature.before(section);
  else pagePropertiesHost.append(section);

  const input = section.querySelector<HTMLInputElement>("[data-examcheck-absence-highlight]")!;
  const trigger = section.querySelector<HTMLButtonElement>(".examcheck-absence-color-trigger")!;
  const popover = section.querySelector<HTMLElement>(".examcheck-absence-color-popover")!;
  const colorInput = section.querySelector<HTMLInputElement>('input[type="color"]')!;
  const previewStyle = section.querySelector<HTMLStyleElement>("style")!;
  let config = absenceHighlightSettings(getCurrentPage()?.settings || selectedPage.settings);
  input.checked = config.enabled;

  const closePopover = () => {
    popover.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };
  const write = () => {
    const page = getCurrentPage();
    if (!page || page.id !== selectedPage.id) return;
    page.settings ||= {};
    page.settings.absenceHighlight = { ...config };
    selectedPage.settings ||= {};
    selectedPage.settings.absenceHighlight = { ...config };
  };
  const updatePreview = () => {
    const rows = new Set(config.enabled ? absenceTableTags(surfaceElement).map((tag) => tag.closest("tr")) : []);
    surfaceElement.querySelectorAll("[data-examcheck-absence-preview]").forEach((row) => {
      if (!rows.has(row as HTMLTableRowElement)) row.removeAttribute("data-examcheck-absence-preview");
    });
    rows.forEach((row) => row?.setAttribute("data-examcheck-absence-preview", "true"));
    previewStyle.textContent = `[data-examcheck-absence-preview="true"] > :is(td,th){background-color:${config.color}!important}`;
    colorInput.value = config.color;
    section.querySelectorAll<HTMLButtonElement>("[data-absence-color]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.absenceColor === config.color));
    });
  };
  const syncAvailability = (dirty: boolean) => {
    const available = absenceTableTags(surfaceElement).length > 0;
    input.disabled = !available;
    trigger.disabled = !available;
    section.classList.toggle("is-absence-tag-missing", !available);
    section.title = available ? "" : "표의 셀에 결시 여부 데이터 태그를 먼저 추가해 주세요.";
    if (!available) {
      closePopover();
      if (config.enabled) {
        config = { ...config, enabled: false };
        input.checked = false;
        write();
        if (dirty) onDirty();
      }
    }
    updatePreview();
  };
  const toggle = () => {
    if (input.disabled) return;
    config = { ...config, enabled: input.checked };
    write();
    updatePreview();
    onDirty();
  };
  const changeColor = (color: string) => {
    if (trigger.disabled || !/^#[0-9a-f]{6}$/i.test(color)) return;
    config = { ...config, color };
    write();
    updatePreview();
    onDirty();
  };
  const click = (event: MouseEvent) => {
    const target = event.target as Element;
    const swatch = target.closest<HTMLButtonElement>("[data-absence-color]");
    if (swatch) changeColor(swatch.dataset.absenceColor!);
    if (target.closest(".examcheck-absence-color-trigger") && !trigger.disabled) {
      popover.hidden = !popover.hidden;
      trigger.setAttribute("aria-expanded", String(!popover.hidden));
      if (!popover.hidden) {
        popover.classList.remove("is-above");
        const panelBottom = pagePropertiesHost.getBoundingClientRect().bottom;
        if (popover.getBoundingClientRect().bottom > panelBottom - 8) popover.classList.add("is-above");
      }
    }
  };
  const customColor = () => changeColor(colorInput.value);
  const outside = (event: Event) => {
    if (!section.contains(event.target as Node)) closePopover();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !popover.hidden) {
      closePopover();
      trigger.focus();
    }
  };
  const doc = section.ownerDocument;
  const observer = new MutationObserver(() => syncAvailability(true));
  observer.observe(surfaceElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-template-tag-value"],
  });
  syncAvailability(false);
  input.addEventListener("change", toggle);
  section.addEventListener("click", click);
  colorInput.addEventListener("input", customColor);
  doc.addEventListener("pointerdown", outside);
  doc.addEventListener("keydown", key);
  return () => {
    observer.disconnect();
    input.removeEventListener("change", toggle);
    section.removeEventListener("click", click);
    colorInput.removeEventListener("input", customColor);
    doc.removeEventListener("pointerdown", outside);
    doc.removeEventListener("keydown", key);
    surfaceElement
      .querySelectorAll("[data-examcheck-absence-preview]")
      .forEach((row) => row.removeAttribute("data-examcheck-absence-preview"));
    section.remove();
  };
}
