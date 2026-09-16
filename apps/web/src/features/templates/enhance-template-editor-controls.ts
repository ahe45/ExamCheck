import type {
  TemplateEditorDocument,
  TemplateEditorInstance,
  TemplateEditorPage,
} from "../../shared/templates/template-editor-contracts";
import { bindLineHeightControl } from "examlist-template-editor/examlist/template-editor/editor-line-height-control";
import { bindObjectAlignmentControls } from "examlist-template-editor/examlist/template-editor/object-alignment-controls";
import { bindObjectPointerControls } from "examlist-template-editor/examlist/template-editor/object-pointer-controls";
import { bindObjectSizeControls } from "examlist-template-editor/examlist/template-editor/object-size-controls";
import { bindPageNumberControls } from "examlist-template-editor/examlist/template-editor/page-number-controls";
import { showToast } from "examlist-template-editor/examlist/app/toast";
import { bindSignatureNameControls } from "./signature-name-controls";
import { bindDataTagFormatControls } from "./data-tag-format-controls";
import { bindTemplateLineAlignment } from "./editor/template-line-alignment";
import type { TemplateEditorTransactionCoordinator } from "./editor/template-editor-transaction-coordinator";
import {
  createTemplateEditorCommandDispatcher,
  type TemplateEditorCommandDispatcher,
} from "./editor/template-editor-command-dispatcher";
import {
  bindTemplateEditorCanvasSelectionPersistence,
  bindTemplateEditorToolbarFocusPersistence,
} from "./template-editor-selection-sync";

function getSelectedPage(editor: TemplateEditorInstance): TemplateEditorPage | null {
  const value = editor.getValue();
  if (!value || typeof value === "string") return null;
  const pages = (value as TemplateEditorDocument).layout?.pages || [];
  const selectedPageId = editor.getSelectedPageId();
  return pages.find((page) => page.id === selectedPageId) || pages[0] || null;
}

export function enhanceTemplateEditorControls(
  root: HTMLElement,
  editor: TemplateEditorInstance,
  transactions: TemplateEditorTransactionCoordinator,
  commandDispatcher?: TemplateEditorCommandDispatcher,
) {
  const pagePropertiesHost = root.querySelector<HTMLElement>(".template-page-properties-panel");
  const surfaceElement = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]");
  const toolbarHost = root.querySelector<HTMLElement>(".editor-toolbar");
  const dataTagHost = root.querySelector<HTMLElement>("[data-template-editor-runtime-tag-panel]");
  const selectedPage = getSelectedPage(editor);
  if (!pagePropertiesHost || !surfaceElement || !toolbarHost || !selectedPage) return () => undefined;

  const appState = {
    templateEditor: {
      get selectedPageId() {
        return editor.getSelectedPageId();
      },
      get template() {
        return editor.getValue();
      },
    },
  };
  const markDirty = () => transactions.request("editor-control.change");
  const showPasteError = (event: Event) => {
    if (event instanceof CustomEvent && typeof event.detail?.message === "string") {
      const isColumnName =
        event.target instanceof Element &&
        Boolean(event.target.closest('[data-candidate-block-editor-surface-id="columnName"]'));
      const message = isColumnName
        ? event.detail.message.replace(
            "데이터 블록 크기를 키워주세요.",
            "컬럼명 행 높이(px)를 늘리거나 표 너비를 줄여주세요.",
          )
        : event.detail.message;
      showToast(message, { tone: "warning" });
    }
  };
  root.addEventListener("template-editor-paste-error", showPasteError);
  const showTableCopied = () => showToast("표를 복사했습니다.");
  root.addEventListener("template-editor-table-copied", showTableCopied);
  const runtime = editor.getRuntime();
  const commands =
    commandDispatcher ||
    createTemplateEditorCommandDispatcher({ documentSurface: surfaceElement, editor, transactions });
  const disposers = [
    () => root.removeEventListener("template-editor-table-copied", showTableCopied),
    () => root.removeEventListener("template-editor-paste-error", showPasteError),
    bindTemplateEditorCanvasSelectionPersistence(editor, surfaceElement),
    bindTemplateEditorToolbarFocusPersistence(
      editor,
      surfaceElement,
      toolbarHost,
      commands,
      dataTagHost ? [dataTagHost] : [],
    ),
    bindDataTagFormatControls({ commandDispatcher: commands, rootElement: root }),
    bindTemplateLineAlignment({ editor, surface: surfaceElement, toolbar: toolbarHost, commands }),
    bindObjectPointerControls({
      editor: runtime,
      onDirty: markDirty,
      rootElement: root,
      selectedPage,
      surfaceElement,
    }),
    bindLineHeightControl({ editor: runtime, surfaceElement, toolbarHost }),
    bindObjectSizeControls({ editor: runtime, onDirty: markDirty, selectedPage, surfaceElement, toolbarHost }),
    bindObjectAlignmentControls({ editor: runtime, surfaceElement, toolbarHost }),
    bindPageNumberControls({ appState, onDirty: markDirty, pagePropertiesHost, selectedPage, surfaceElement }),
    bindSignatureNameControls({
      pagePropertiesHost,
      selectedPage,
      getCurrentPage: () => getSelectedPage(editor),
      surfaceElement,
      onDirty: markDirty,
    }),
  ];

  const dataBlockSection = pagePropertiesHost.querySelector(".examlist-candidate-block-grid-field");
  const pageNumberSection = pagePropertiesHost.querySelector(".examlist-page-number-field");
  const signatureSection = pagePropertiesHost.querySelector(".examcheck-signature-name-field");
  if (dataBlockSection && signatureSection) dataBlockSection.after(signatureSection);
  if (signatureSection && pageNumberSection) signatureSection.after(pageNumberSection);

  return () => {
    [...disposers].reverse().forEach((dispose) => dispose?.());
  };
}
