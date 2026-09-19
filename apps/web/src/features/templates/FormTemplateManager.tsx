import { forwardRef, lazy, Suspense, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  fetchFormTemplate,
  type FormTemplateSummary,
  fetchAdminFormTemplates,
  fetchFormTemplateDataTags,
  type FormTemplate,
} from "../../shared/api/form-templates";
import type { DataTagCatalog } from "../../shared/templates/template-editor-contracts";
import type { PrinterService } from "../printer/PrinterService";
import type { PrinterDiagnostic } from "../printer/printer.types";
import { LabelTemplateManager, type LabelTemplateManagerHandle } from "./LabelTemplateManager";
import type { TemplateEditorWorkspaceHandle } from "./TemplateEditorWorkspace";
import { TemplateLibrary } from "./TemplateLibrary";
import { createBlankDraft, toDraft, type DraftTemplate } from "./template-manager-model";
import type { TemplateNoticeValue } from "./TemplateNotice";

const LazyTemplateEditorWorkspace = lazy(() => import("./TemplateEditorWorkspaceLazy"));

export const formTemplateEditorSessionStorageKey = "examcheck.form-template-editor.session.v1";

interface FormTemplateEditorSession {
  sourceId: string;
  draft?: DraftTemplate;
}

function isDraftTemplate(value: unknown): value is DraftTemplate {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<DraftTemplate>;
  return (
    typeof draft.code === "string" &&
    typeof draft.name === "string" &&
    typeof draft.description === "string" &&
    typeof draft.category === "string" &&
    typeof draft.usageScope === "string" &&
    typeof draft.layout === "object" &&
    draft.layout !== null &&
    typeof draft.active === "boolean" &&
    typeof draft.isNew === "boolean"
  );
}

function readEditorSession(): FormTemplateEditorSession | null {
  try {
    const rawValue = window.sessionStorage.getItem(formTemplateEditorSessionStorageKey);
    if (!rawValue) return null;
    const value = JSON.parse(rawValue) as Partial<FormTemplateEditorSession>;
    if (typeof value.sourceId !== "string" || !value.sourceId) return null;
    return {
      sourceId: value.sourceId,
      ...(isDraftTemplate(value.draft) ? { draft: value.draft } : {}),
    };
  } catch {
    return null;
  }
}

function persistEditorSession(sourceId: string, draft?: DraftTemplate) {
  if (!sourceId) return;
  try {
    window.sessionStorage.setItem(formTemplateEditorSessionStorageKey, JSON.stringify({ sourceId, draft }));
  } catch {
    try {
      window.sessionStorage.setItem(formTemplateEditorSessionStorageKey, JSON.stringify({ sourceId }));
    } catch {
      // Storage may be unavailable or full. The editor remains usable without restoration.
    }
  }
}

function clearEditorSession() {
  try {
    window.sessionStorage.removeItem(formTemplateEditorSessionStorageKey);
  } catch {
    // Storage may be unavailable in hardened browser contexts.
  }
}

export interface FormTemplateManagerHandle {
  save(): Promise<boolean>;
}

interface FormTemplateManagerProps {
  token: string;
  resetKey?: number;
  printerService?: PrinterService;
  printerDiagnostic?: PrinterDiagnostic;
  onDirtyChange?(dirty: boolean): void;
}

export const FormTemplateManager = forwardRef<FormTemplateManagerHandle, FormTemplateManagerProps>(
  function FormTemplateManager({ token, resetKey = 0, printerService, printerDiagnostic, onDirtyChange }, ref) {
    const workspaceRef = useRef<TemplateEditorWorkspaceHandle>(null);
    const labelManagerRef = useRef<LabelTemplateManagerHandle>(null);
    const restoredSessionRef = useRef<FormTemplateEditorSession | null>(readEditorSession());
    const editorSourceIdRef = useRef("");
    const editRequest = useRef(0);
    const pendingSession = useRef<FormTemplateEditorSession | null>(null);
    const storageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flushSession = useCallback(() => {
      if (storageTimer.current) clearTimeout(storageTimer.current);
      storageTimer.current = null;
      const pending = pendingSession.current;
      pendingSession.current = null;
      if (pending && pending.sourceId === editorSourceIdRef.current)
        persistEditorSession(pending.sourceId, pending.draft);
    }, []);
    useEffect(() => {
      const requestCounter = editRequest;
      window.addEventListener("pagehide", flushSession);
      return () => {
        requestCounter.current++;
        flushSession();
        window.removeEventListener("pagehide", flushSession);
      };
    }, [flushSession]);
    const [templates, setTemplates] = useState<FormTemplateSummary[]>([]);
    const [dataTags, setDataTags] = useState<DataTagCatalog | null>(null);
    const [draft, setDraft] = useState<DraftTemplate | null>(null);
    const [editorSourceId, setEditorSourceId] = useState("");
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [notice, setNotice] = useState<TemplateNoticeValue | null>(null);
    const [templateKind, setTemplateKind] = useState<"document" | "label">("document");
    const [sectionDirty, setSectionDirty] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        save: () =>
          templateKind === "label"
            ? (labelManagerRef.current?.save() ?? Promise.resolve(true))
            : (workspaceRef.current?.save() ?? Promise.resolve(true)),
      }),
      [templateKind],
    );

    const handleDirtyChange = useCallback(
      (dirty: boolean) => {
        setSectionDirty(dirty);
        onDirtyChange?.(dirty);
      },
      [onDirtyChange],
    );

    useEffect(() => {
      let active = true;
      void Promise.all([fetchAdminFormTemplates(token), fetchFormTemplateDataTags(token)])
        .then(async ([loadedTemplates, loadedTags]) => {
          if (!active) return;
          setTemplates(loadedTemplates);
          setDataTags(loadedTags);
          const restoredSession = restoredSessionRef.current;
          restoredSessionRef.current = null;
          if (restoredSession) {
            const templateIdMatch = /^template-(\d+)$/.exec(restoredSession.sourceId);
            const storedTemplate = templateIdMatch
              ? loadedTemplates.find((template) => template.id === Number(templateIdMatch[1]))
              : null;
            const restoredDraft = restoredSession.sourceId.startsWith("new-")
              ? restoredSession.draft || null
              : storedTemplate
                ? restoredSession.draft || toDraft(await fetchFormTemplate(token, storedTemplate.code, true))
                : null;

            if (!active) return;
            if (restoredDraft) {
              editorSourceIdRef.current = restoredSession.sourceId;
              setEditorSourceId(restoredSession.sourceId);
              setDraft(restoredDraft);
            } else {
              clearEditorSession();
            }
          }
        })
        .catch((reason: unknown) => {
          if (!active) return;
          setNotice({
            kind: "error",
            text: reason instanceof Error ? reason.message : "양식 정보를 불러오지 못했습니다.",
          });
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [token]);

    useEffect(() => {
      if (resetKey > 0) {
        clearEditorSession();
        restoredSessionRef.current = null;
        editorSourceIdRef.current = "";
        setEditorSourceId("");
        setDraft(null);
        setTemplateKind("document");
        handleDirtyChange(false);
      }
    }, [handleDirtyChange, resetKey]);

    useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

    const editTemplate = useCallback(
      async (template: FormTemplateSummary) => {
        const request = ++editRequest.current;
        let detail: FormTemplate;
        try {
          detail = await fetchFormTemplate(token, template.code, true);
        } catch (reason) {
          setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "양식을 불러오지 못했습니다." });
          return;
        }
        if (request !== editRequest.current) return;
        const nextDraft = toDraft(detail);
        if (!nextDraft) return;
        setNotice(null);
        setDraft(nextDraft);
        const sourceId = `template-${template.id}`;
        editorSourceIdRef.current = sourceId;
        setEditorSourceId(sourceId);
        persistEditorSession(sourceId, nextDraft);
      },
      [token],
    );

    const createTemplate = useCallback(() => {
      editRequest.current++;
      const now = Date.now();
      setNotice(null);
      const nextDraft = createBlankDraft(
        now,
        templates.map((template) => template.code),
      );
      const sourceId = `new-${now}`;
      setDraft(nextDraft);
      editorSourceIdRef.current = sourceId;
      setEditorSourceId(sourceId);
      persistEditorSession(sourceId, nextDraft);
    }, [templates]);

    const refreshTemplates = useCallback(async () => {
      if (refreshing) return;
      setRefreshing(true);
      setNotice(null);
      try {
        const [loadedTemplates, loadedTags] = await Promise.all([
          fetchAdminFormTemplates(token),
          fetchFormTemplateDataTags(token),
        ]);
        setTemplates(loadedTemplates);
        setDataTags(loadedTags);
      } catch (reason) {
        setNotice({
          kind: "error",
          text: reason instanceof Error ? reason.message : "양식 정보를 불러오지 못했습니다.",
        });
      } finally {
        setRefreshing(false);
      }
    }, [refreshing, token]);

    const handleTemplateUpdated = useCallback((updated: FormTemplate) => {
      setTemplates((current) =>
        current.some((item) => item.code === updated.code)
          ? current.map((item) => (item.code === updated.code ? updated : item))
          : [...current, updated],
      );
    }, []);

    const handleTemplateDeleted = useCallback((code: string) => {
      setTemplates((current) => current.filter((item) => item.code !== code));
    }, []);

    const handleTemplateSaved = useCallback((saved: FormTemplate) => {
      pendingSession.current = null;
      const nextDraft = toDraft(saved);
      if (!nextDraft) return;
      setTemplates((current) =>
        current.some((item) => item.code === saved.code)
          ? current.map((item) => (item.code === saved.code ? saved : item))
          : [...current, saved],
      );
      setDraft(nextDraft);
      const sourceId = `template-${saved.id}`;
      editorSourceIdRef.current = sourceId;
      setEditorSourceId(sourceId);
      persistEditorSession(sourceId, nextDraft);
    }, []);

    const closeEditor = useCallback(() => {
      editRequest.current++;
      pendingSession.current = null;
      clearEditorSession();
      editorSourceIdRef.current = "";
      setEditorSourceId("");
      setDraft(null);
      setNotice(null);
    }, []);

    const updateDraft = useCallback(
      (nextDraft: DraftTemplate) => {
        setDraft(nextDraft);
        pendingSession.current = { sourceId: editorSourceIdRef.current, draft: nextDraft };
        if (!storageTimer.current) storageTimer.current = setTimeout(flushSession, 200);
      },
      [flushSession],
    );

    if (loading) {
      return <div className="admin-view-loading">양식 관리 화면을 준비하고 있습니다.</div>;
    }
    if (!dataTags) {
      return (
        <div className="admin-view-empty">
          <p>{notice?.text || "양식 편집기를 불러올 수 없습니다."}</p>
        </div>
      );
    }

    if (!draft) {
      return (
        <div className="template-management-shell">
          <nav className="template-kind-tabs" aria-label="양식 종류">
            <button
              className={templateKind === "document" ? "active" : ""}
              onClick={() => setTemplateKind("document")}
              disabled={sectionDirty && templateKind !== "document"}
            >
              문서 양식
            </button>
            <button
              className={templateKind === "label" ? "active" : ""}
              onClick={() => setTemplateKind("label")}
              disabled={sectionDirty && templateKind !== "label"}
            >
              라벨 양식
            </button>
          </nav>
          {templateKind === "document" ? (
            <TemplateLibrary
              token={token}
              templates={templates}
              refreshing={refreshing}
              notice={notice}
              onNoticeChange={setNotice}
              onCreate={createTemplate}
              onEdit={editTemplate}
              onRefresh={refreshTemplates}
              onTemplateDeleted={handleTemplateDeleted}
              onTemplateUpdated={handleTemplateUpdated}
            />
          ) : (
            <LabelTemplateManager
              ref={labelManagerRef}
              token={token}
              service={printerService}
              diagnostic={printerDiagnostic}
              dataTags={dataTags}
              onDirtyChange={handleDirtyChange}
            />
          )}
        </div>
      );
    }

    return (
      <Suspense fallback={<div className="admin-view-loading">양식 편집기를 불러오는 중입니다.</div>}>
        <LazyTemplateEditorWorkspace
          key={editorSourceId}
          ref={workspaceRef}
          token={token}
          sourceId={editorSourceId}
          draft={draft}
          dataTags={dataTags}
          initialInformationOpen={editorSourceId.startsWith("new-")}
          notice={notice}
          onClose={closeEditor}
          onDraftChange={updateDraft}
          onDirtyChange={handleDirtyChange}
          onNoticeChange={setNotice}
          onTemplateSaved={handleTemplateSaved}
        />
      </Suspense>
    );
  },
);
