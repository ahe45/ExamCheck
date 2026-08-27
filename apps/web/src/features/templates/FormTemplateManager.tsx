import { forwardRef, lazy, Suspense, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { fetchAdminFormTemplates, fetchFormTemplateDataTags, type FormTemplate } from "../../shared/api/form-templates";
import type { DataTagCatalog } from "../../shared/templates/template-editor-contracts";
import type { TemplateEditorWorkspaceHandle } from "./TemplateEditorWorkspace";
import { TemplateLibrary } from "./TemplateLibrary";
import { createBlankDraft, toDraft, type DraftTemplate } from "./template-manager-model";
import type { TemplateNoticeValue } from "./TemplateNotice";

const LazyTemplateEditorWorkspace = lazy(() => import("./TemplateEditorWorkspaceLazy"));

export interface FormTemplateManagerHandle {
  save(): Promise<boolean>;
}

interface FormTemplateManagerProps {
  token: string;
  resetKey?: number;
  onDirtyChange?(dirty: boolean): void;
}

export const FormTemplateManager = forwardRef<FormTemplateManagerHandle, FormTemplateManagerProps>(
  function FormTemplateManager({ token, resetKey = 0, onDirtyChange }, ref) {
    const workspaceRef = useRef<TemplateEditorWorkspaceHandle>(null);
    const [templates, setTemplates] = useState<FormTemplate[]>([]);
    const [dataTags, setDataTags] = useState<DataTagCatalog | null>(null);
    const [draft, setDraft] = useState<DraftTemplate | null>(null);
    const [editorSourceId, setEditorSourceId] = useState("");
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [notice, setNotice] = useState<TemplateNoticeValue | null>(null);

    useImperativeHandle(ref, () => ({
      save: () => workspaceRef.current?.save() ?? Promise.resolve(true),
    }));

    useEffect(() => {
      let active = true;
      void Promise.all([fetchAdminFormTemplates(token), fetchFormTemplateDataTags(token)])
        .then(([loadedTemplates, loadedTags]) => {
          if (!active) return;
          setTemplates(loadedTemplates);
          setDataTags(loadedTags);
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
      if (resetKey > 0) setDraft(null);
    }, [resetKey]);

    useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

    const editTemplate = useCallback((template: FormTemplate) => {
      const nextDraft = toDraft(template);
      if (!nextDraft) return;
      setNotice(null);
      setDraft(nextDraft);
      setEditorSourceId(`template-${template.id}`);
    }, []);

    const createTemplate = useCallback(() => {
      const now = Date.now();
      setNotice(null);
      setDraft(createBlankDraft(now));
      setEditorSourceId(`new-${now}`);
    }, []);

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
      setTemplates((current) => current.map((item) => (item.code === updated.code ? updated : item)));
    }, []);

    const handleTemplateSaved = useCallback((saved: FormTemplate, refreshed: FormTemplate[]) => {
      const nextDraft = toDraft(saved);
      if (!nextDraft) return;
      setTemplates(refreshed);
      setDraft(nextDraft);
      setEditorSourceId(`template-${saved.id}`);
    }, []);

    const closeEditor = useCallback(() => {
      setDraft(null);
      setNotice(null);
    }, []);

    const updateDraft = useCallback((nextDraft: DraftTemplate) => {
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
        <TemplateLibrary
          token={token}
          templates={templates}
          refreshing={refreshing}
          notice={notice}
          onNoticeChange={setNotice}
          onCreate={createTemplate}
          onEdit={editTemplate}
          onRefresh={refreshTemplates}
          onTemplateUpdated={handleTemplateUpdated}
        />
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
          onDirtyChange={onDirtyChange}
          onNoticeChange={setNotice}
          onTemplateSaved={handleTemplateSaved}
        />
      </Suspense>
    );
  },
);
