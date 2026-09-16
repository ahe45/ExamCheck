import type {
  TemplateEditorDocument,
  TemplateEditorInstance,
  TemplateEditorPage,
} from "../../shared/templates/template-editor-contracts";
import { bindCandidateBlockGridControls } from "examlist-template-editor/examlist/template-editor/candidate-block-grid-adapter";
import type { TemplateEditorTransactionCoordinator } from "./editor/template-editor-transaction-coordinator";
import { bindCanvasTableJoining } from "./editor/template-table-joining";
import { normalizeCandidateBlockGridConfig } from "examlist-template-editor/core";
import { normalizeCandidateBlockTemplateHtmlFromElement } from "examlist-template-editor/dom";

function getSelectedPage(editor: TemplateEditorInstance): TemplateEditorPage | null {
  const value = editor.getValue();
  if (!value || typeof value === "string") return null;
  const pages = (value as TemplateEditorDocument).layout?.pages || [];
  const selectedPageId = editor.getSelectedPageId();
  return pages.find((page) => page.id === selectedPageId) || pages[0] || null;
}

export function enhanceTemplateDataBlock(
  root: HTMLElement,
  editor: TemplateEditorInstance,
  transactions: TemplateEditorTransactionCoordinator,
) {
  const pagePropertiesHost = root.querySelector<HTMLElement>(".template-page-properties-panel");
  const surfaceElement = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]");
  const selectedPage = getSelectedPage(editor);
  if (!pagePropertiesHost || !surfaceElement || !selectedPage) return () => undefined;
  // Older saves retained the rendered grid but lost its settings because the
  // controls edited a page snapshot that getValue() subsequently replaced.
  const existingGrid = surfaceElement.querySelector<HTMLElement>("[data-candidate-block-grid]");
  if (existingGrid && !selectedPage.settings?.candidateBlockGrid) {
    const style = getComputedStyle(existingGrid);
    const points = (value: string) => (Number.parseFloat(value) || 0) * 0.75;
    selectedPage.settings ||= {};
    selectedPage.settings.candidateBlockGrid = normalizeCandidateBlockGridConfig({
      enabled: true,
      columns: existingGrid.dataset.candidateBlockColumns,
      rows: existingGrid.dataset.candidateBlockRows,
      gapXPt: points(style.columnGap),
      gapYPt: points(style.rowGap),
      widthPt: points(style.width),
      heightPt: points(style.height),
      xPt: points(style.left),
      yPt: points(style.top),
      blockTemplateHtml: normalizeCandidateBlockTemplateHtmlFromElement(
        existingGrid.querySelector<HTMLElement>("[data-candidate-block-instance]"),
      ),
      columnNameRow: {
        enabled: existingGrid.dataset.candidateBlockColumnNameRowEnabled === "true",
        heightPt: Number(existingGrid.dataset.candidateBlockColumnNameRowHeightPt) || 20,
        templateHtml: normalizeCandidateBlockTemplateHtmlFromElement(
          existingGrid.querySelector<HTMLElement>("[data-candidate-block-column-name]"),
        ),
      },
    });
  }
  const persistBlockSettings = () => {
    const currentPage = getSelectedPage(editor);
    if (!currentPage || currentPage.id !== selectedPage.id) return;
    currentPage.settings ||= {};
    currentPage.settings.candidateBlockGrid = structuredClone(selectedPage.settings?.candidateBlockGrid);
  };
  persistBlockSettings();
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
  const disposeControls =
    bindCandidateBlockGridControls({
      appState,
      editor: editor.getRuntime(),
      onDirty: () => {
        persistBlockSettings();
        transactions.request("candidate-block.change");
      },
      pagePropertiesHost,
      selectedPage,
      surfaceElement,
    }) || (() => undefined);

  const disposeTableJoining = bindCanvasTableJoining(root, surfaceElement);
  return () => {
    disposeControls();
    disposeTableJoining();
  };
}
