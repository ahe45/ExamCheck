import type { TemplateEditorInstance } from "../../shared/templates/template-editor-contracts";
import { selectCandidateBlockGridElement } from "examlist-template-editor/examlist/template-editor/candidate-block-grid-selection";
import type { TemplateEditorCommandDispatcher } from "./editor/template-editor-command-dispatcher";
import { ensureTemplateTokenCaret } from "./editor/template-token-caret";
import {
  captureTemplateTextSelection,
  restoreTemplateTextSelection,
  type TemplateTextSelection,
} from "./editor/template-text-selection";

type RuntimeWithObjectSelection = {
  state?: {
    templateEditor?: {
      savedRange?: Range | null;
      savedSelectionSnapshot?: unknown;
      selectedImageElement?: HTMLImageElement | null;
      selectedTableElement?: HTMLTableElement | null;
      suppressToolbarSelectionChange?: boolean;
    };
  };
  updateImageSelectionOverlay?(): void;
  updateTableObjectOverlay?(): void;
};

const TOOLBAR_POINTER_ACTION_SELECTOR = [
  "button:not(:disabled)",
  "[role='button']:not([aria-disabled='true'])",
  "[role='option']:not([aria-disabled='true'])",
].join(", ");

function getActiveEditingSurface(surfaceElement: HTMLElement) {
  return (
    surfaceElement.querySelector<HTMLElement>("[data-template-editor-runtime-active-surface='true']") || surfaceElement
  );
}

function cloneSelectionInsideSurface(activeSurface: HTMLElement) {
  const selection = activeSurface.ownerDocument.defaultView?.getSelection();
  if (!selection?.rangeCount) return null;

  const range = selection.getRangeAt(0);
  const containsBoundary = (node: Node | null) =>
    Boolean(node && (node === activeSurface || activeSurface.contains(node)));
  if (!containsBoundary(range.startContainer) || !containsBoundary(range.endContainer)) return null;

  try {
    return range.cloneRange();
  } catch {
    return null;
  }
}

function isCandidateBlockTableDimensionInput(
  target: EventTarget | null,
  surfaceElement: HTMLElement,
  toolbarHost: HTMLElement,
) {
  const element = target instanceof Element ? target : null;
  const input = element?.closest<HTMLInputElement>(".template-table-insert-panel input[type='number']") || null;
  const activeSurface = getActiveEditingSurface(surfaceElement);

  return Boolean(
    input &&
    toolbarHost.contains(input) &&
    activeSurface !== surfaceElement &&
    activeSurface.matches("[data-candidate-block-modal-editor-surface]") &&
    activeSurface.dataset.templateEditorRuntimeActiveSurface === "true",
  );
}

export function bindTemplateEditorToolbarFocusPersistence(
  editor: TemplateEditorInstance,
  surfaceElement: HTMLElement,
  toolbarHost: HTMLElement,
  commandDispatcher?: TemplateEditorCommandDispatcher,
  additionalCommandHosts: HTMLElement[] = [],
) {
  const runtime = editor.getRuntime() as RuntimeWithObjectSelection;
  const ownerWindow = surfaceElement.ownerDocument.defaultView;
  let disposed = false;
  let selectionRevision = 0;
  let textSelection: { surface: HTMLElement; snapshot: TemplateTextSelection } | null = null;
  const invalidateTextSelection = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target && toolbarHost.contains(target)) return;
    selectionRevision += 1;
    textSelection = null;
  };
  const captureTextSelection = () => {
    const surface = getActiveEditingSurface(surfaceElement);
    const content = surface.querySelector<HTMLElement>(":scope > .template-doc") || surface;
    const snapshot = captureTemplateTextSelection(content);
    if (snapshot) textSelection = { surface, snapshot };
  };

  const preserveFormattingSelection = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !toolbarHost.contains(target)) return;
    const action = target.closest(
      "[data-template-command], [data-editor-font-family-option], [data-editor-font-size-option], " +
        "[data-editor-color-preset], [data-editor-color-apply], [data-template-line-height-option], input, select",
    );
    if (!action || ["undo", "redo"].includes(action.getAttribute("data-template-command") || "")) return;
    captureTextSelection();
    const saved = textSelection;
    // Replacing a collapsed selection would clear the browser's pending typing
    // format, such as Bold enabled before the user types the next character.
    if (!saved || saved.snapshot.start === saved.snapshot.end) return;
    const revision = selectionRevision;
    // Native event dispatch can run microtasks between capture and bubble
    // listeners. Wait for the entire command event, including runtime handlers.
    ownerWindow?.setTimeout(() => {
      if (disposed || revision !== selectionRevision || saved.surface !== getActiveEditingSurface(surfaceElement))
        return;
      const content = saved.surface.querySelector<HTMLElement>(":scope > .template-doc") || saved.surface;
      if (!restoreTemplateTextSelection(content, saved.snapshot)) return;
      const range = cloneSelectionInsideSurface(saved.surface);
      const runtimeState = runtime.state?.templateEditor;
      if (range && runtimeState) {
        runtimeState.savedRange = range;
        runtimeState.savedSelectionSnapshot = null;
      }
      commandDispatcher?.captureSelection();
    }, 0);
  };

  const handleToolbarPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const commandHost = [toolbarHost, ...additionalCommandHosts].find((host) => host.contains(target));
    if (!commandHost) return;

    const activeSurface = getActiveEditingSurface(surfaceElement);
    const range = cloneSelectionInsideSurface(activeSurface);
    const runtimeState = runtime.state?.templateEditor;

    if (range && runtimeState) {
      // The bundled editor keeps a path snapshot as well as a Range. A snapshot
      // from the previous toolbar command wins during restoration, so clear it
      // and refresh the live Range before every pointer-driven toolbar action.
      runtimeState.savedRange = range;
      runtimeState.savedSelectionSnapshot = null;
      runtimeState.suppressToolbarSelectionChange = true;
    }
    commandDispatcher?.captureSelection();
    captureTextSelection();

    const isFormControl = Boolean(target.closest("input, select, textarea, [contenteditable='true']"));
    const action = target.closest(TOOLBAR_POINTER_ACTION_SELECTOR);
    if (action && commandHost.contains(action) && !isFormControl) {
      event.preventDefault();
    }
  };

  const isolateTableDimensionEvent = (event: Event) => {
    if (!isCandidateBlockTableDimensionInput(event.target, surfaceElement, toolbarHost)) return;
    if (event instanceof KeyboardEvent && !["ArrowUp", "ArrowDown"].includes(event.key)) return;

    // These controls are configuration inputs, not candidate-block content.
    // Stop later window-level modal handlers without cancelling the native
    // number input step so keyboard arrows and spinner buttons keep working.
    event.stopImmediatePropagation();
  };

  toolbarHost.addEventListener("pointerdown", handleToolbarPointerDown, true);
  toolbarHost.addEventListener("click", preserveFormattingSelection, true);
  toolbarHost.addEventListener("change", preserveFormattingSelection, true);
  surfaceElement.ownerDocument.addEventListener("pointerdown", invalidateTextSelection, true);
  surfaceElement.ownerDocument.addEventListener("keydown", invalidateTextSelection, true);
  additionalCommandHosts.forEach((host) => host.addEventListener("pointerdown", handleToolbarPointerDown, true));
  ownerWindow?.addEventListener("keydown", isolateTableDimensionEvent, true);
  ownerWindow?.addEventListener("beforeinput", isolateTableDimensionEvent, true);
  ownerWindow?.addEventListener("input", isolateTableDimensionEvent, true);
  ownerWindow?.addEventListener("change", isolateTableDimensionEvent, true);
  return () => {
    disposed = true;
    toolbarHost.removeEventListener("pointerdown", handleToolbarPointerDown, true);
    toolbarHost.removeEventListener("click", preserveFormattingSelection, true);
    toolbarHost.removeEventListener("change", preserveFormattingSelection, true);
    surfaceElement.ownerDocument.removeEventListener("pointerdown", invalidateTextSelection, true);
    surfaceElement.ownerDocument.removeEventListener("keydown", invalidateTextSelection, true);
    additionalCommandHosts.forEach((host) => host.removeEventListener("pointerdown", handleToolbarPointerDown, true));
    ownerWindow?.removeEventListener("keydown", isolateTableDimensionEvent, true);
    ownerWindow?.removeEventListener("beforeinput", isolateTableDimensionEvent, true);
    ownerWindow?.removeEventListener("input", isolateTableDimensionEvent, true);
    ownerWindow?.removeEventListener("change", isolateTableDimensionEvent, true);
  };
}

type ObjectSelectionSnapshot = {
  index: number;
  kind: "image" | "table";
  modalSurfaceId: string;
};

function getSelectableObjects(surfaceElement: HTMLElement) {
  return Array.from(
    surfaceElement.querySelectorAll<HTMLElement>(
      "img.template-editor-image-object, img.template-generated-object, img.is-selected-object, .template-doc table, [data-candidate-block-modal-editor-surface] table",
    ),
  ).filter((element, index, elements) => elements.indexOf(element) === index);
}

function getModalSurfaceId(element: Element) {
  return (
    element.closest<HTMLElement>("[data-candidate-block-modal-editor-surface]")?.dataset
      .candidateBlockEditorSurfaceId || ""
  );
}

function captureObjectSelection(
  surfaceElement: HTMLElement,
  preferredElements: HTMLElement[] = [],
): ObjectSelectionSnapshot[] {
  const objects = getSelectableObjects(surfaceElement);
  const preferredSet = new Set(preferredElements);
  const hasPreferredSelection = preferredSet.size > 0;

  return objects
    .filter(
      (element) =>
        (hasPreferredSelection && preferredSet.has(element)) ||
        (!hasPreferredSelection &&
          (element.classList.contains("is-selected-object") || element.classList.contains("is-selected-table-object"))),
    )
    .map((element) => {
      const kind = element instanceof HTMLTableElement ? "table" : "image";
      const modalSurfaceId = getModalSurfaceId(element);
      const peers = objects.filter(
        (candidate) =>
          (candidate instanceof HTMLTableElement ? "table" : "image") === kind &&
          getModalSurfaceId(candidate) === modalSurfaceId,
      );

      return { index: peers.indexOf(element), kind, modalSurfaceId };
    });
}

function getPointerSelectionTarget(target: Element | null, surfaceElement: HTMLElement) {
  const directImage = target?.closest<HTMLImageElement>(
    "img.template-editor-image-object, img.template-generated-object, img.is-selected-object",
  );
  if (directImage && surfaceElement.contains(directImage)) return directImage;

  const tableOverlay = target?.closest<HTMLElement>(".template-editor-table-selection") as
    (HTMLElement & { __templateEditorTableElement?: HTMLTableElement | null }) | null;
  const overlayTable = tableOverlay?.__templateEditorTableElement;
  if (overlayTable && surfaceElement.contains(overlayTable)) return overlayTable;

  return null;
}

function restoreObjectSelection(
  surfaceElement: HTMLElement,
  runtime: RuntimeWithObjectSelection,
  snapshots: ObjectSelectionSnapshot[],
) {
  const objects = getSelectableObjects(surfaceElement);
  const selectedElements = snapshots
    .map((snapshot) => {
      const peers = objects.filter(
        (candidate) =>
          (candidate instanceof HTMLTableElement ? "table" : "image") === snapshot.kind &&
          getModalSurfaceId(candidate) === snapshot.modalSurfaceId,
      );
      return peers[snapshot.index] || null;
    })
    .filter((element): element is HTMLElement => element instanceof HTMLElement);
  const selectedSet = new Set(selectedElements);

  objects.forEach((element) => {
    const selected = selectedSet.has(element);
    element.classList.toggle("is-selected-object", selected);
    element.classList.toggle("is-selected-table-object", selected && element instanceof HTMLTableElement);
  });

  const runtimeState = runtime.state?.templateEditor;
  const selectedImage =
    selectedElements.length === 1 && selectedElements[0] instanceof HTMLImageElement ? selectedElements[0] : null;
  const selectedTable =
    selectedElements.length === 1 && selectedElements[0] instanceof HTMLTableElement ? selectedElements[0] : null;

  if (runtimeState) {
    runtimeState.selectedImageElement = selectedImage;
    runtimeState.selectedTableElement = selectedTable;
  }
  runtime.updateImageSelectionOverlay?.();
  runtime.updateTableObjectOverlay?.();
}

export function syncTemplateEditorPreservingCanvasSelection(
  editor: TemplateEditorInstance,
  surfaceElement: HTMLElement,
) {
  const runtime = editor.getRuntime() as RuntimeWithObjectSelection;
  const objectSelection = captureObjectSelection(surfaceElement);
  const selectedGrid = surfaceElement.querySelector<HTMLElement>(
    "[data-candidate-block-grid].is-selected-candidate-block-grid",
  );
  const gridIndex = selectedGrid
    ? Array.from(surfaceElement.querySelectorAll("[data-candidate-block-grid]")).indexOf(selectedGrid)
    : -1;
  const value = editor.sync();

  const restore = () => {
    if (!surfaceElement.isConnected) return;
    if (objectSelection.length > 0) restoreObjectSelection(surfaceElement, runtime, objectSelection);
    if (gridIndex >= 0) {
      const grids = surfaceElement.querySelectorAll<HTMLElement>("[data-candidate-block-grid]");
      selectCandidateBlockGridElement(grids[gridIndex] || null, { focus: false });
    }
  };

  restore();
  window.requestAnimationFrame(restore);
  return value;
}

export function bindTemplateEditorCanvasSelectionPersistence(
  editor: TemplateEditorInstance,
  surfaceElement: HTMLElement,
) {
  const runtime = editor.getRuntime() as RuntimeWithObjectSelection;
  let objectSelection: ObjectSelectionSnapshot[] = [];
  let selectedGridIndex = -1;
  let disposed = false;

  const restoreTokenCaret = (event: Event) => {
    if (
      event instanceof KeyboardEvent &&
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "End", "Home"].includes(event.key)
    )
      return;
    surfaceElement.ownerDocument.defaultView?.setTimeout(() => {
      if (disposed) return;
      const activeSurface = getActiveEditingSurface(surfaceElement);
      if (activeSurface.ownerDocument.activeElement !== activeSurface) return;
      const range = ensureTemplateTokenCaret(activeSurface);
      if (range && runtime.state?.templateEditor) {
        runtime.state.templateEditor.savedRange = range;
        runtime.state.templateEditor.savedSelectionSnapshot = null;
      }
    }, 0);
  };

  const handleTokenClick = (event: MouseEvent) => {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return;
    const target = event.target instanceof Element ? event.target : null;
    const token = target?.closest<HTMLElement>(".template-token[contenteditable='false'][data-template-tag-value]");
    const activeSurface = getActiveEditingSurface(surfaceElement);
    if (!token || !activeSurface.contains(token)) return;
    // The document's data-block preview opens its own editor; keep that action.
    if (activeSurface === surfaceElement && token.closest("[data-candidate-block-grid]")) return;
    event.preventDefault();
    surfaceElement.ownerDocument.defaultView?.setTimeout(() => {
      if (disposed || !token.isConnected || activeSurface !== getActiveEditingSurface(surfaceElement)) return;
      activeSurface.focus({ preventScroll: true });
      const range = token.ownerDocument.createRange();
      range.selectNode(token);
      const selection = token.ownerDocument.defaultView?.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const runtimeState = runtime.state?.templateEditor;
      if (runtimeState) {
        runtimeState.savedRange = range.cloneRange();
        runtimeState.savedSelectionSnapshot = null;
      }
    }, 0);
  };

  const handlePointerDown = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const pointerTarget = getPointerSelectionTarget(target, surfaceElement);
    objectSelection = pointerTarget ? captureObjectSelection(surfaceElement, [pointerTarget]) : [];

    const targetGrid = target?.closest<HTMLElement>("[data-candidate-block-grid]");
    selectedGridIndex = targetGrid
      ? Array.from(surfaceElement.querySelectorAll("[data-candidate-block-grid]")).indexOf(targetGrid)
      : -1;
  };
  const handlePointerEnd = () => {
    if (objectSelection.length === 0 && selectedGridIndex < 0) return;
    const snapshots = objectSelection;
    const gridIndex = selectedGridIndex;
    objectSelection = [];
    selectedGridIndex = -1;

    window.requestAnimationFrame(() => {
      if (!surfaceElement.isConnected) return;
      if (snapshots.length > 0) restoreObjectSelection(surfaceElement, runtime, snapshots);
      if (gridIndex >= 0) {
        const grids = surfaceElement.querySelectorAll<HTMLElement>("[data-candidate-block-grid]");
        selectCandidateBlockGridElement(grids[gridIndex] || null, { focus: false });
      }
    });
  };

  surfaceElement.addEventListener("pointerdown", handlePointerDown, true);
  surfaceElement.addEventListener("click", handleTokenClick, true);
  surfaceElement.addEventListener("click", restoreTokenCaret);
  surfaceElement.addEventListener("keyup", restoreTokenCaret);
  window.addEventListener("pointerup", handlePointerEnd, true);
  window.addEventListener("pointercancel", handlePointerEnd, true);

  return () => {
    disposed = true;
    surfaceElement.removeEventListener("pointerdown", handlePointerDown, true);
    surfaceElement.removeEventListener("click", handleTokenClick, true);
    surfaceElement.removeEventListener("click", restoreTokenCaret);
    surfaceElement.removeEventListener("keyup", restoreTokenCaret);
    window.removeEventListener("pointerup", handlePointerEnd, true);
    window.removeEventListener("pointercancel", handlePointerEnd, true);
  };
}
