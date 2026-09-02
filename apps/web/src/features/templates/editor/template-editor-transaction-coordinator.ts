export type TemplateEditorScope =
  | { id: "document"; kind: "document"; surface: HTMLElement }
  | { id: string; kind: "candidate-block"; surface: HTMLElement };

export interface TemplateEditorTransaction {
  reasons: readonly string[];
  revision: number;
  scope: TemplateEditorScope;
}

interface CoordinatorOptions {
  commit(transaction: TemplateEditorTransaction): void;
  documentSurface: HTMLElement;
  onDirty(transaction: TemplateEditorTransaction): void;
  schedule?(callback: () => void): void;
}

export interface TemplateEditorTransactionCoordinator {
  dispose(): void;
  flush(): boolean;
  getScope(): TemplateEditorScope;
  request(reason: string): void;
}

function getCandidateBlockScopeId(surface: HTMLElement) {
  return `candidate-block:${surface.dataset.candidateBlockEditorSurfaceId || "dataBlock"}`;
}

export function resolveTemplateEditorScope(documentSurface: HTMLElement): TemplateEditorScope {
  const activeSurface = documentSurface.querySelector<HTMLElement>(
    "[data-template-editor-runtime-active-surface='true'][data-candidate-block-modal-editor-surface]",
  );

  if (activeSurface) {
    return {
      id: getCandidateBlockScopeId(activeSurface),
      kind: "candidate-block",
      surface: activeSurface,
    };
  }

  return { id: "document", kind: "document", surface: documentSurface };
}

export function createTemplateEditorTransactionCoordinator({
  commit,
  documentSurface,
  onDirty,
  schedule = queueMicrotask,
}: CoordinatorOptions): TemplateEditorTransactionCoordinator {
  let disposed = false;
  let pending = false;
  let revision = 0;
  const reasons = new Set<string>();

  const snapshot = (): TemplateEditorTransaction => ({
    reasons: Object.freeze(Array.from(reasons)),
    revision,
    scope: resolveTemplateEditorScope(documentSurface),
  });

  const flush = () => {
    pending = false;
    if (disposed || reasons.size === 0) return false;

    const transaction = snapshot();
    if (transaction.scope.kind !== "document") return false;
    if (
      documentSurface.querySelector(
        "[data-candidate-block-focus-layer], .examlist-candidate-block-focus-layer, [data-candidate-block-modal-editor-surface]",
      )
    ) {
      return false;
    }

    reasons.clear();
    commit(transaction);
    return true;
  };

  const request = (reason: string) => {
    if (disposed) return;
    revision += 1;
    reasons.add(String(reason || "unknown"));
    onDirty(snapshot());
    if (pending) return;
    pending = true;
    schedule(flush);
  };

  return {
    dispose() {
      disposed = true;
      pending = false;
      reasons.clear();
    },
    flush,
    getScope: () => resolveTemplateEditorScope(documentSurface),
    request,
  };
}
