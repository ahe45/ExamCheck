import { TemplateEditorMetadataBar } from "./TemplateEditorMetadataBar";
import { BarcodeSourcePicker } from "./BarcodeSourcePicker";
import { bindBarcodeSourceControl, type BarcodeSourceRequest } from "./barcode-source-control";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ListButtonIcon, PreviewButtonIcon, SaveButtonIcon } from "../../shared/components/ActionIcons";
import { saveFormTemplate, type FormTemplate } from "../../shared/api/form-templates";
import type {
  DataTagCatalog,
  DataTagViewOptions,
  TemplateEditorInstance,
} from "../../shared/templates/template-editor-contracts";
import { decorateCatalog, enhanceDataTagPanel, readDataTagViewOptions } from "./enhance-data-tag-panel";
import { enhanceTemplateEditorCanvas } from "./enhance-template-editor-canvas";
import { enhanceTemplateEditorControls } from "./enhance-template-editor-controls";
import { enhanceTemplatePageProperties } from "./enhance-template-page-properties";
import { enhanceTemplateDataBlock } from "./enhance-template-data-block";
import { buildTemplateEditorAssetUrl } from "./generated-object-assets";
import { mountProjectTemplateEditor } from "./editor/examlist-template-editor-adapter";
import { prepareTemplateEditorMount } from "./editor/template-editor-mount-compatibility";
import { createTemplateEditorTransactionCoordinator } from "./editor/template-editor-transaction-coordinator";
import { createTemplateEditorCommandDispatcher } from "./editor/template-editor-command-dispatcher";
import { serializeTemplateEditorHtml, serializeTemplateEditorValue } from "./editor/template-editor-serialization";
import { DataTagSettingsModal, TemplateInformationModal } from "./TemplateEditorModals";
import {
  buildSampleValues,
  createDraftMetadataSnapshot,
  getTemplateSampleData,
  isDraftMetadataDirty,
  updateDraftMetadata,
  updateTagExamples,
  updateTemplateSampleData,
  validateDraft,
  type DraftTemplate,
} from "./template-manager-model";
import { TemplateNotice, type TemplateNoticeValue } from "./TemplateNotice";
import { syncTemplateEditorPreservingCanvasSelection } from "./template-editor-selection-sync";
import { openTemplatePrintWindow, renderTemplateHtml } from "./template-renderer";
import { formatProjectDataTagSampleValue } from "./editor/examlist-template-formatting";
import { getDataTagFormatType } from "./data-tag-formatting";

export interface TemplateEditorWorkspaceHandle {
  save(): Promise<boolean>;
}

interface TemplateEditorWorkspaceProps {
  token: string;
  sourceId: string;
  draft: DraftTemplate;
  dataTags: DataTagCatalog;
  initialInformationOpen: boolean;
  notice: TemplateNoticeValue | null;
  onClose(): void;
  onDraftChange(draft: DraftTemplate): void;
  onDirtyChange?(dirty: boolean): void;
  onNoticeChange(notice: TemplateNoticeValue | null): void;
  onTemplateSaved(template: FormTemplate): void;
}

export const TemplateEditorWorkspace = forwardRef<TemplateEditorWorkspaceHandle, TemplateEditorWorkspaceProps>(
  function TemplateEditorWorkspace(
    {
      token,
      sourceId,
      draft,
      dataTags,
      initialInformationOpen,
      notice,
      onClose,
      onDraftChange,
      onDirtyChange,
      onNoticeChange,
      onTemplateSaved,
    },
    ref,
  ) {
    const rootRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<TemplateEditorInstance | null>(null);
    const draftRef = useRef(draft);
    const pendingLayoutRef = useRef<DraftTemplate["layout"] | null>(null);
    const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flushDraftRef = useRef<() => void>(() => {});
    flushDraftRef.current = () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
      const layout = pendingLayoutRef.current;
      pendingLayoutRef.current = null;
      if (layout) {
        const next = { ...draftRef.current, layout: serializeTemplateEditorValue(layout) };
        draftRef.current = next;
        onDraftChange(next);
      }
    };
    useEffect(() => {
      const flush = () => flushDraftRef.current();
      window.addEventListener("pagehide", flush);
      return () => {
        window.removeEventListener("pagehide", flush);
        flush();
      };
    }, []);
    const saveInFlightRef = useRef<Promise<boolean> | null>(null);
    const imperativeSaveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
    const viewOptionsRef = useRef<DataTagViewOptions>(readDataTagViewOptions());
    const initialMetadataSnapshotRef = useRef(createDraftMetadataSnapshot(draft));
    const [editorDirty, setEditorDirty] = useState(false);
    const [showInformation, setShowInformation] = useState(initialInformationOpen);
    const [showTagSettings, setShowTagSettings] = useState(false);
    const [barcodeSource, setBarcodeSource] = useState<BarcodeSourceRequest | null>(null);
    const [tagSettingsRevision, setTagSettingsRevision] = useState(0);
    const [actionBusy, setActionBusy] = useState<"preview" | "save" | null>(null);
    const [overflowMessage, setOverflowMessage] = useState("");
    const decoratedDataTags = useMemo(() => decorateCatalog(dataTags), [dataTags]);

    draftRef.current = draft;
    const dirty = editorDirty || isDraftMetadataDirty(draft, initialMetadataSnapshotRef.current);

    useEffect(() => {
      onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);
    useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

    useImperativeHandle(
      ref,
      () => ({
        save: () => imperativeSaveRef.current(),
      }),
      [],
    );

    // The imperative editor reads layout while disposing its controls. Clean it
    // up before React detaches the canvas and its geometry becomes zero.
    useLayoutEffect(() => {
      const root = rootRef.current;
      const activeDraft = draftRef.current;
      if (!root || !activeDraft) return;
      editorRef.current?.destroy();
      root.replaceChildren();
      const editorDataTags = updateTagExamples(decoratedDataTags, getTemplateSampleData(activeDraft.layout));
      const preparedTemplate = prepareTemplateEditorMount(activeDraft.layout);
      const editor = mountProjectTemplateEditor({
        root,
        template: preparedTemplate,
        dataTags: editorDataTags,
        layoutMode: "desktop",
        permissions: { canManageTemplates: true },
        generatedObjectSourceKey: "candidate.examNo",
        previewData: buildSampleValues(editorDataTags),
        getTemplateEditorTagDisplay: ({ definition, iconMarkup, label, formatValue, formatType }) => {
          const example = formatProjectDataTagSampleValue(
            definition || "",
            definition?.example,
            formatValue,
            formatType,
          );
          return {
            hideIcons: !viewOptionsRef.current.showIcons,
            iconMarkup,
            sampleDisplay: viewOptionsRef.current.showSampleData,
            text: viewOptionsRef.current.showSampleData && example ? example : label,
            title: [label, example, getDataTagFormatType(definition || "") ? "클릭하여 표시 형식 변경" : ""]
              .filter(Boolean)
              .join(" · "),
          };
        },
        adapters: {
          buildApiUrl: buildTemplateEditorAssetUrl,
          saveTemplate: async ({ template }) => {
            const metadata = draftRef.current;
            if (!metadata || typeof template === "string") return template;
            const serializedTemplate = serializeTemplateEditorValue(template);
            validateDraft(metadata);
            onNoticeChange(null);
            try {
              const saved = await saveFormTemplate(token, {
                code: metadata.code,
                name: metadata.name,
                description: metadata.description,
                category: metadata.category,
                usageScope: metadata.usageScope,
                active: metadata.active,
                layout: serializedTemplate,
              });
              initialMetadataSnapshotRef.current = createDraftMetadataSnapshot(metadata);
              pendingLayoutRef.current = null;
              if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
              draftTimerRef.current = null;
              onTemplateSaved(saved);
              setEditorDirty(false);
              onNoticeChange({
                kind: "success",
                text: `${saved.name} 양식을 저장했습니다.`,
              });
              return saved.layout;
            } catch (reason) {
              const message = reason instanceof Error ? reason.message : "양식을 저장하지 못했습니다.";
              onNoticeChange({ kind: "error", text: message });
              throw reason;
            }
          },
          previewPdf: ({ html }) => ({ html: serializeTemplateEditorHtml(html), pageCount: 1, warnings: [] }),
        },
        onChange: (layout) => {
          if (typeof layout !== "string") {
            pendingLayoutRef.current = layout;
            if (!draftTimerRef.current) draftTimerRef.current = setTimeout(() => flushDraftRef.current(), 200);
          }
        },
        onDirtyChange: setEditorDirty,
        onOverflowChange: (info, message) => setOverflowMessage(info.hasOverflow ? message : ""),
      });
      editorRef.current = editor;
      const documentSurface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]");
      if (!documentSurface) {
        editor.destroy();
        editorRef.current = null;
        return;
      }
      const transactions = createTemplateEditorTransactionCoordinator({
        commit: () => syncTemplateEditorPreservingCanvasSelection(editor, documentSurface),
        documentSurface,
        onDirty: () => setEditorDirty(true),
      });
      const commands = createTemplateEditorCommandDispatcher({ documentSurface, editor, transactions });
      const disposeCanvas = enhanceTemplateEditorCanvas(root);
      const pageProperties = enhanceTemplatePageProperties(root);
      const disposeDataBlock = enhanceTemplateDataBlock(root, editor, transactions);
      const disposeEditorControls = enhanceTemplateEditorControls(root, editor, transactions, commands);
      const disposeBarcodeSource = bindBarcodeSourceControl({
        root,
        editor,
        commands,
        catalog: editorDataTags,
        onOpen: setBarcodeSource,
      });
      const disposeTagPanel = enhanceDataTagPanel({
        root,
        catalog: editorDataTags,
        editor,
        commandDispatcher: commands,
        viewOptions: viewOptionsRef.current,
        onViewOptionsChange: (options) => {
          viewOptionsRef.current = options;
        },
        onOpenSettings: () => setShowTagSettings(true),
      });
      return () => {
        flushDraftRef.current();
        transactions.dispose();
        disposeTagPanel();
        disposeBarcodeSource();
        disposeEditorControls();
        disposeDataBlock();
        pageProperties.dispose();
        disposeCanvas();
        editor.destroy();
        if (editorRef.current === editor) editorRef.current = null;
      };
    }, [decoratedDataTags, onDraftChange, onNoticeChange, onTemplateSaved, sourceId, tagSettingsRevision, token]);

    function updateMetadata<K extends keyof DraftTemplate>(key: K, value: DraftTemplate[K]) {
      flushDraftRef.current();
      onDraftChange(updateDraftMetadata(draftRef.current, key, value));
    }

    function closeEditor() {
      flushDraftRef.current();
      if (dirty && !window.confirm("저장하지 않은 변경 내용이 있습니다. 양식 목록으로 이동할까요?")) {
        return;
      }
      setShowInformation(false);
      onNoticeChange(null);
      onClose();
    }

    function previewTemplate() {
      flushDraftRef.current();
      const editor = editorRef.current;
      const metadata = draftRef.current;
      if (!editor) return;
      setActionBusy("preview");
      onNoticeChange(null);
      try {
        const previewTags = updateTagExamples(decoratedDataTags, getTemplateSampleData(metadata.layout));
        const html = renderTemplateHtml(serializeTemplateEditorHtml(editor.getHtml()), buildSampleValues(previewTags));
        openTemplatePrintWindow(`${metadata.name} 미리보기`, html);
      } catch (reason) {
        onNoticeChange({
          kind: "error",
          text: reason instanceof Error ? reason.message : "미리보기를 열지 못했습니다.",
        });
      } finally {
        setActionBusy(null);
      }
    }

    async function saveTemplateVersion() {
      flushDraftRef.current();
      if (saveInFlightRef.current) return saveInFlightRef.current;
      const editor = editorRef.current;
      if (!editor) return false;
      const saveTask = (async () => {
        setActionBusy("save");
        onNoticeChange(null);
        try {
          await editor.save({ reason: "user-submit" });
          setShowInformation(false);
          return true;
        } catch (reason) {
          onNoticeChange({
            kind: "error",
            text: reason instanceof Error ? reason.message : "양식을 저장하지 못했습니다.",
          });
          return false;
        } finally {
          setActionBusy(null);
        }
      })();
      saveInFlightRef.current = saveTask;
      try {
        return await saveTask;
      } finally {
        if (saveInFlightRef.current === saveTask) saveInFlightRef.current = null;
      }
    }

    imperativeSaveRef.current = () =>
      saveInFlightRef.current ?? (dirty ? saveTemplateVersion() : Promise.resolve(true));

    return (
      <section className="examlist-template-editor-view">
        <TemplateEditorMetadataBar
          name={draft.name}
          description={draft.description}
          onNameChange={(value) => updateMetadata("name", value)}
          onDescriptionChange={(value) => updateMetadata("description", value)}
        >
          <button className="exam-outline-button template-editor-list-button" type="button" onClick={closeEditor}>
            <ListButtonIcon />
            <span>양식 목록</span>
          </button>
          <button
            className="exam-ghost-button ghost-button template-editor-preview-button"
            type="button"
            disabled={actionBusy !== null}
            onClick={previewTemplate}
          >
            <PreviewButtonIcon />
            <span>{actionBusy === "preview" ? "준비 중" : "미리보기"}</span>
          </button>
          <button
            className="exam-primary-button primary-button template-editor-save-button"
            type="button"
            disabled={!dirty || actionBusy !== null || Boolean(overflowMessage)}
            onClick={() => void saveTemplateVersion()}
          >
            <SaveButtonIcon />
            <span>{actionBusy === "save" ? "저장 중" : "저장"}</span>
          </button>
        </TemplateEditorMetadataBar>
        {overflowMessage && (
          <div className="template-editor-status-bar error">
            {overflowMessage} 문서 영역 안으로 내용을 조정해야 저장할 수 있습니다.
          </div>
        )}
        {notice && <TemplateNotice notice={notice} onClose={() => onNoticeChange(null)} />}
        <div className="template-editor-frame">
          <div ref={rootRef} className="template-editor-host" />
        </div>

        {showInformation && (
          <TemplateInformationModal draft={draft} onChange={updateMetadata} onClose={() => setShowInformation(false)} />
        )}
        {barcodeSource && (
          <BarcodeSourcePicker
            catalog={barcodeSource.catalog}
            onSelect={barcodeSource.insert}
            onClose={() => setBarcodeSource(null)}
          />
        )}
        {showTagSettings && (
          <DataTagSettingsModal
            catalog={updateTagExamples(decoratedDataTags, getTemplateSampleData(draft.layout))}
            onClose={() => setShowTagSettings(false)}
            onSave={(examples) => {
              onDraftChange({
                ...draftRef.current,
                layout: updateTemplateSampleData(draftRef.current.layout, examples),
              });
              setTagSettingsRevision((value) => value + 1);
              setShowTagSettings(false);
              setEditorDirty(true);
            }}
          />
        )}
      </section>
    );
  },
);
