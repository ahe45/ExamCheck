import type {
  TemplateEditorDocument,
  TemplateEditorInstance,
  TemplateEditorPage,
} from "../../shared/templates/template-editor-contracts";
import { bindCandidateBlockGridControls } from "examlist-template-editor/examlist/template-editor/candidate-block-grid-adapter";
import type { TemplateEditorTransactionCoordinator } from "./editor/template-editor-transaction-coordinator";

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
      onDirty: () => transactions.request("candidate-block.change"),
      pagePropertiesHost,
      selectedPage,
      surfaceElement,
    }) || (() => undefined);

  return () => {
    disposeControls();
  };
}
