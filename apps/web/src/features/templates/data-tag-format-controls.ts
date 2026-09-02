import {
  getDataTagFormatInputError,
  getDataTagFormatOptions,
  getDataTagFormatTokenGuides,
  getDataTagFormatType,
  normalizeDataTagFormat,
  renderDataTagFormatPreview,
} from "examlist-template-editor";
import { normalizeTemplateDataTagKey } from "./template-data-projection";
import type { TemplateEditorCommandDispatcher } from "./editor/template-editor-command-dispatcher";

export function bindDataTagFormatControls({
  commandDispatcher,
  rootElement,
  onDirty,
}: {
  commandDispatcher?: TemplateEditorCommandDispatcher;
  rootElement: HTMLElement;
  onDirty?(): void;
}) {
  let activeToken: HTMLElement | null = null;
  let overlay: HTMLElement | null = null;

  const close = () => {
    overlay?.remove();
    overlay = null;
    const token = activeToken;
    activeToken = null;
    if (token?.isConnected) token.focus({ preventScroll: true });
  };

  const open = (token: HTMLElement) => {
    const key = normalizeTemplateDataTagKey(token.dataset.templateTagValue || "");
    const formatType = token.dataset.templateTagFormatType || getDataTagFormatType(key);
    if (!formatType) return false;

    close();
    activeToken = token;
    const label = String(token.dataset.templateTagLabel || token.textContent || key).trim() || key;
    const initialFormat = normalizeDataTagFormat(formatType, token.dataset.templateTagFormat || "");
    overlay = document.createElement("div");
    overlay.className = "examcheck-data-tag-format-backdrop";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "examcheckDataTagFormatTitle");
    overlay.innerHTML = renderModal({ formatType, formatValue: initialFormat, label });
    document.body.append(overlay);

    const preset = overlay.querySelector<HTMLSelectElement>("[data-data-tag-format-preset]");
    const input = overlay.querySelector<HTMLInputElement>("[data-data-tag-format-input]");
    const preview = overlay.querySelector<HTMLElement>("[data-data-tag-format-preview]");
    const error = overlay.querySelector<HTMLElement>("[data-data-tag-format-error]");
    const apply = overlay.querySelector<HTMLButtonElement>("[data-data-tag-format-apply]");

    const syncFeedback = () => {
      if (!input || !preview || !error || !apply) return;
      const value = input.value.slice(0, 60);
      if (input.value !== value) input.value = value;
      const errorMessage = getDataTagFormatInputError(formatType, value);
      error.textContent = errorMessage;
      error.hidden = !errorMessage;
      preview.textContent = errorMessage
        ? "올바른 형식을 입력해 주세요."
        : renderDataTagFormatPreview(formatType, value) || "기본 형식으로 표시됩니다.";
      apply.disabled = Boolean(errorMessage);
      if (preset) {
        const matching = Array.from(preset.options).find((option) => option.value === value);
        preset.value = matching ? value : "__custom__";
      }
    };
    const applyFormat = () => {
      if (!activeToken || !input) return;
      const errorMessage = getDataTagFormatInputError(formatType, input.value);
      if (errorMessage) {
        syncFeedback();
        input.focus();
        return;
      }
      const applyMutation = () => {
        if (!activeToken) return false;
        const normalized = normalizeDataTagFormat(formatType, input.value);
        if (normalized) {
          activeToken.dataset.templateTagFormatType = formatType;
          activeToken.dataset.templateTagFormat = normalized;
        } else {
          delete activeToken.dataset.templateTagFormatType;
          delete activeToken.dataset.templateTagFormat;
        }
        activeToken.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "formatSetBlockTextDirection" }));
        return true;
      };
      if (commandDispatcher) {
        commandDispatcher.execute({ id: "data-tag.format", mutate: applyMutation, restoreSelection: false });
      } else if (applyMutation()) {
        onDirty?.();
      }
      close();
    };

    preset?.addEventListener("change", () => {
      if (!input || preset.value === "__custom__") return;
      input.value = preset.value;
      syncFeedback();
    });
    input?.addEventListener("input", syncFeedback);
    overlay
      .querySelectorAll<HTMLElement>("[data-data-tag-format-close]")
      .forEach((button) => button.addEventListener("click", close));
    apply?.addEventListener("click", applyFormat);
    overlay.addEventListener("pointerdown", (event) => {
      if (event.target === overlay) close();
    });
    syncFeedback();
    window.requestAnimationFrame(() => preset?.focus({ preventScroll: true }));
    return true;
  };

  const handleClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const token = target?.closest<HTMLElement>(".template-token[data-template-tag-value]");
    if (!token || !rootElement.contains(token)) return;
    const key = normalizeTemplateDataTagKey(token.dataset.templateTagValue || "");
    if (!token.dataset.templateTagFormatType && !getDataTagFormatType(key)) return;
    event.preventDefault();
    event.stopPropagation();
    open(token);
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && overlay) {
      event.preventDefault();
      close();
    }
  };

  rootElement.addEventListener("click", handleClick, true);
  document.addEventListener("keydown", handleKeyDown);
  return () => {
    rootElement.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeyDown);
    close();
  };
}

function renderModal({ formatType, formatValue, label }: { formatType: string; formatValue: string; label: string }) {
  const options = getDataTagFormatOptions(formatType);
  const guides = getDataTagFormatTokenGuides(formatType);
  const hasPreset = options.some((option) => option.value === formatValue);
  return `
    <section class="examcheck-data-tag-format-modal">
      <header>
        <div><p>데이터 태그 서식</p><h2 id="examcheckDataTagFormatTitle">${escapeMarkup(label)}</h2></div>
        <button type="button" data-data-tag-format-close aria-label="데이터 태그 서식 닫기">×</button>
      </header>
      <div class="examcheck-data-tag-format-body">
        <label class="examcheck-data-tag-format-field">
          <span>표시 형식</span>
          <select data-data-tag-format-preset>
            ${!hasPreset && formatValue ? '<option value="__custom__">직접 입력</option>' : ""}
            ${options
              .map(
                (option) =>
                  `<option value="${escapeMarkup(option.value)}" ${option.value === formatValue ? "selected" : ""}>${escapeMarkup(option.preview)} · ${escapeMarkup(option.label)}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label class="examcheck-data-tag-format-field">
          <span>직접 입력</span>
          <input data-data-tag-format-input type="text" maxlength="60" autocomplete="off" spellcheck="false"
            value="${escapeMarkup(formatValue)}" placeholder="${formatType === "time" ? "HH:mm" : "YYYY.MM.DD (ddd)"}" />
        </label>
        <div class="examcheck-data-tag-format-preview">
          <span>예시 결과</span><strong data-data-tag-format-preview></strong>
        </div>
        <p class="examcheck-data-tag-format-error" data-data-tag-format-error hidden></p>
        <div class="examcheck-data-tag-format-guide">
          <strong>사용 가능한 토큰</strong>
          <div>${guides
            .map(
              (guide) =>
                `<span><code>${escapeMarkup(guide.token)}</code><small>${escapeMarkup(guide.description)} · ${escapeMarkup(guide.example)}</small></span>`,
            )
            .join("")}</div>
        </div>
      </div>
      <footer>
        <button class="exam-ghost-button" type="button" data-data-tag-format-close>취소</button>
        <button class="exam-primary-button" type="button" data-data-tag-format-apply>적용</button>
      </footer>
    </section>`;
}

function escapeMarkup(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character,
  );
}
