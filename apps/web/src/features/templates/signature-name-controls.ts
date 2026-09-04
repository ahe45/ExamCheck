import type { TemplateEditorPage } from "../../shared/templates/template-editor-contracts";
import {
  getTemplateSignatureNameInputEnabled,
  templateSignatureFields,
  writeTemplateSignatureNameInputEnabled,
} from "./template-signatures";
import { normalizeTemplateDataTagKey } from "./template-data-projection";

export function bindSignatureNameControls({
  pagePropertiesHost,
  selectedPage,
  surfaceElement,
  onDirty,
}: {
  pagePropertiesHost: HTMLElement;
  selectedPage: TemplateEditorPage;
  surfaceElement: HTMLElement;
  onDirty(): void;
}) {
  pagePropertiesHost.querySelector(".examcheck-signature-name-field")?.remove();
  const section = document.createElement("section");
  section.className = "template-page-property-field examcheck-signature-name-field";
  section.innerHTML = `
    <div class="examlist-page-number-header examcheck-signature-name-header">
      <span>서명자명 입력</span>
      <label class="examlist-switch-control">
        <input class="sr-only" data-examcheck-signature-name-setting="enabled" type="checkbox" aria-label="PDF 생성 전 서명자명 입력" ${getTemplateSignatureNameInputEnabled({ layout: { pages: [selectedPage] } }) ? "checked" : ""} />
        <span class="examlist-switch-track" aria-hidden="true"><span></span></span>
      </label>
    </div>
  `;

  const pageNumberSection = pagePropertiesHost.querySelector(".examlist-page-number-field");
  if (pageNumberSection) pageNumberSection.before(section);
  else pagePropertiesHost.append(section);

  const input = section.querySelector<HTMLInputElement>("[data-examcheck-signature-name-setting]");
  const hasSignatureTag = () => {
    const usedKeys = Array.from(surfaceElement.querySelectorAll<HTMLElement>("[data-template-tag-value]"), (element) =>
      normalizeTemplateDataTagKey(element.dataset.templateTagValue || ""),
    );
    return templateSignatureFields.some((field) => usedKeys.includes(field.key));
  };
  const syncAvailability = (markDirty: boolean) => {
    if (!input) return;
    const available = hasSignatureTag();
    input.disabled = !available;
    section.classList.toggle("is-signature-tag-missing", !available);
    section.title = available ? "" : "캔버스에 작성자 또는 확인자 데이터 태그를 먼저 추가해 주세요.";
    if (!available && input.checked) {
      input.checked = false;
      writeTemplateSignatureNameInputEnabled(selectedPage, false);
      if (markDirty) onDirty();
    }
  };
  const apply = () => {
    if (!input || input.disabled) return;
    writeTemplateSignatureNameInputEnabled(selectedPage, input.checked);
    onDirty();
  };
  const observer = new MutationObserver(() => syncAvailability(true));
  observer.observe(surfaceElement, {
    attributes: true,
    attributeFilter: ["data-template-tag-value"],
    childList: true,
    subtree: true,
  });
  syncAvailability(false);
  input?.addEventListener("change", apply);

  return () => {
    observer.disconnect();
    input?.removeEventListener("change", apply);
    section.remove();
  };
}
