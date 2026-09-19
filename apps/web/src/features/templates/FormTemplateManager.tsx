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
import {
  FORM_EDITOR_SESSION_KEY,
  LABEL_EDITOR_SESSION_KEY,
  TEMPLATE_TAB_SESSION_KEY,
  readTemplateSession,
  writeTemplateSession,
  clearTemplateSession,
} from "../../shared/session/template-session";

const LazyTemplateEditorWorkspace = lazy(() => import("./TemplateEditorWorkspaceLazy"));

const formTemplateEditorSessionStorageKey = FORM_EDITOR_SESSION_KEY;

interface FormTemplateEditorSession {
  sourceId: string;
}

function readEditorSession(): FormTemplateEditorSession | null {
  try {
    const rawValue = window.sessionStorage.getItem(formTemplateEditorSessionStorageKey);
    if (!rawValue) return null;
    const value = JSON.parse(rawValue) as Partial<FormTemplateEditorSession>;
    if (typeof value.sourceId !== "string" || !value.sourceId) return null;
    return {
      sourceId: value.sourceId,
    };
  } catch {
    return null;
  }
}

function persistEditorSession(sourceId: string) {
  if (!sourceId) return;
  writeTemplateSession(formTemplateEditorSessionStorageKey, { sourceId });
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
    const [initialEditorSession] = useState(() =>
      resetKey === 0 && readTemplateSession(TEMPLATE_TAB_SESSION_KEY) !== "label" ? readEditorSession() : null,
    );
    const restoredSessionRef = useRef<FormTemplateEditorSession | null>(initialEditorSession);
    const editorSourceIdRef = useRef("");
    const editRequest = useRef(0);
    const mounted = useRef(true);
    useEffect(() => {
      mounted.current = true;
      const requestCounter = editRequest;
      return () => {
        mounted.current = false;
        requestCounter.current++;
      };
    }, []);
    const [templates, setTemplates] = useState<FormTemplateSummary[]>([]);
    const [dataTags, setDataTags] = useState<DataTagCatalog | null>(null);
    const [draft, setDraft] = useState<DraftTemplate | null>(null);
    const [editorSourceId, setEditorSourceId] = useState("");
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [notice, setNotice] = useState<TemplateNoticeValue | null>(null);
    const [templateKind, setTemplateKind] = useState<"document" | "label">(() =>
      resetKey === 0 && readTemplateSession(TEMPLATE_TAB_SESSION_KEY) === "label" ? "label" : "document",
    );
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
          if (restoredSession) {
            const templateIdMatch = /^template-(\d+)$/.exec(restoredSession.sourceId);
            const storedTemplate = templateIdMatch
              ? loadedTemplates.find((template) => template.id === Number(templateIdMatch[1]))
              : null;
            const restoredDraft = restoredSession.sourceId.startsWith("new-")
              ? createBlankDraft(
                  Date.now(),
                  loadedTemplates.map((template) => template.code),
                )
              : storedTemplate
                ? toDraft(await fetchFormTemplate(token, storedTemplate.code, true))
                : null;

            if (!active) return;
            restoredSessionRef.current = null;
            if (restoredDraft) {
              editorSourceIdRef.current = restoredSession.sourceId;
              setEditorSourceId(restoredSession.sourceId);
              setDraft(restoredDraft);
              persistEditorSession(restoredSession.sourceId);
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
        clearTemplateSession(LABEL_EDITOR_SESSION_KEY);
        writeTemplateSession(TEMPLATE_TAB_SESSION_KEY, "document");
        restoredSessionRef.current = null;
        editorSourceIdRef.current = "";
        setEditorSourceId("");
        setDraft(null);
        setTemplateKind("document");
        handleDirtyChange(false);
      }
    }, [handleDirtyChange, resetKey]);

    function selectTemplateKind(kind: "document" | "label") {
      setTemplateKind(kind);
      writeTemplateSession(TEMPLATE_TAB_SESSION_KEY, kind);
    }

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
        persistEditorSession(sourceId);
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
      persistEditorSession(sourceId);
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
      persistEditorSession(sourceId);
    }, []);

    const closeEditor = useCallback(() => {
      editRequest.current++;
      clearEditorSession();
      editorSourceIdRef.current = "";
      setEditorSourceId("");
      setDraft(null);
      setNotice(null);
    }, []);

    const updateDraft = useCallback((nextDraft: DraftTemplate) => {
      if (!mounted.current || !editorSourceIdRef.current) return;
      setDraft(nextDraft);
    }, []);

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
              onClick={() => selectTemplateKind("document")}
              disabled={sectionDirty && templateKind !== "document"}
            >
              문서 양식
            </button>
            <button
              className={templateKind === "label" ? "active" : ""}
              onClick={() => selectTemplateKind("label")}
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
