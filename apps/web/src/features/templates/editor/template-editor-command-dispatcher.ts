import type { TemplateEditorInstance } from "../../../shared/templates/template-editor-contracts";
import type { TemplateEditorTransactionCoordinator } from "./template-editor-transaction-coordinator";

type RuntimeSelectionState = {
  state?: {
    templateEditor?: {
      savedRange?: Range | null;
      savedSelectionSnapshot?: unknown;
      suppressToolbarSelectionChange?: boolean;
    };
  };
};

export interface TemplateEditorCommand<T = unknown> {
  id: string;
  mutate(): T | false;
  reason?: string;
  restoreSelection?: boolean;
}

export interface TemplateEditorCommandDispatcher {
  captureSelection(): Range | null;
  execute<T>(command: TemplateEditorCommand<T>): T | false;
  restoreSelection(): boolean;
}

function getActiveSurface(documentSurface: HTMLElement) {
  return (
    documentSurface.querySelector<HTMLElement>(
      "[data-template-editor-runtime-active-surface='true'][data-candidate-block-modal-editor-surface]",
    ) || documentSurface
  );
}

function cloneRangeInsideSurface(surface: HTMLElement) {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const contains = (node: Node) => node === surface || surface.contains(node);
  if (!contains(range.startContainer) || !contains(range.endContainer)) return null;

  try {
    return range.cloneRange();
  } catch {
    return null;
  }
}

export function createTemplateEditorCommandDispatcher({
  documentSurface,
  editor,
  transactions,
}: {
  documentSurface: HTMLElement;
  editor: TemplateEditorInstance;
  transactions: TemplateEditorTransactionCoordinator;
}): TemplateEditorCommandDispatcher {
  const runtime = editor.getRuntime() as RuntimeSelectionState;
  let savedRange: Range | null = null;

  const captureSelection = () => {
    const range = cloneRangeInsideSurface(getActiveSurface(documentSurface));
    if (!range) return savedRange;
    savedRange = range;
    const runtimeState = runtime.state?.templateEditor;
    if (runtimeState) {
      runtimeState.savedRange = range.cloneRange();
      runtimeState.savedSelectionSnapshot = null;
      runtimeState.suppressToolbarSelectionChange = true;
    }
    return range;
  };

  const restoreSelection = () => {
    const activeSurface = getActiveSurface(documentSurface);
    const range = savedRange;
    if (!range || !activeSurface.isConnected) return false;
    if (!activeSurface.contains(range.startContainer) || !activeSurface.contains(range.endContainer)) return false;
    const selection = activeSurface.ownerDocument.defaultView?.getSelection();
    if (!selection) return false;

    try {
      selection.removeAllRanges();
      selection.addRange(range.cloneRange());
      return true;
    } catch {
      return false;
    }
  };

  return {
    captureSelection,
    execute<T>({
      id,
      mutate,
      reason = `command.${id}`,
      restoreSelection: shouldRestore = true,
    }: TemplateEditorCommand<T>) {
      if (shouldRestore) restoreSelection();
      const result = mutate();
      if (result !== false) {
        captureSelection();
        // Candidate-block commands mutate only the modal draft. The focus
        // editor emits one document transaction when that draft is applied;
        // cancelled drafts must never enable the document Save button.
        if (transactions.getScope().kind === "document") transactions.request(reason);
      }
      return result;
    },
    restoreSelection,
  };
}
