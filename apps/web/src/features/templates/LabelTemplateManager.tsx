import { TemplateEditorMetadataBar } from "./TemplateEditorMetadataBar";
import { BarcodeSourcePicker } from "./BarcodeSourcePicker";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { DataTagCatalog, DataTagDefinition } from "../../shared/templates/template-editor-contracts";
import type { PrinterService } from "../printer/PrinterService";
import type { PrinterDiagnostic } from "../printer/printer.types";
import {
  deleteLabelTemplate,
  fetchLabelTemplates,
  fetchLabelTemplate,
  type LabelTemplateSummary,
  previewLabelTemplate,
  saveLabelTemplate,
  updateLabelTemplateActive,
  type LabelElementKind,
  type LabelTemplate,
  type LabelTemplateElement,
  type LabelTemplateLayout,
} from "../../shared/api/label-templates";
import {
  AddButtonIcon,
  CopyButtonIcon,
  DeleteButtonIcon,
  EditButtonIcon,
  RefreshButtonIcon,
  ListButtonIcon,
  PreviewButtonIcon,
  SaveButtonIcon,
} from "../../shared/components/ActionIcons";
import { TemplateNotice, type TemplateNoticeValue } from "./TemplateNotice";
import { TemplateDeleteModal } from "./TemplateDeleteModal";
import { DataTagSettingsModal } from "./TemplateEditorModals";
import { decorateCatalog, groupDataTags, readDataTagViewOptions } from "./enhance-data-tag-panel";
import { renderProjectDataTagIcon } from "./editor/examlist-template-editor-adapter";
import "./editor/examlist-template-editor-styles";
import {
  clampLabelElement,
  cloneLabelLayout,
  createLabelElement,
  defaultLabelLayout,
  flattenLabelDataTags,
  labelElementTransform,
  replaceLabelSamples,
  rotateLabelElement,
} from "./label-template-model";
import { updateTagExamples } from "./template-manager-model";
import { LabelObjectAlignment } from "./LabelObjectAlignment";
import { LabelObjectNumberField, LabelTextFormatting } from "./LabelTextFormatting";
import { readLabelEditorSession, persistLabelEditorSession } from "./label-editor-session";
import { LABEL_EDITOR_SESSION_KEY, clearTemplateSession } from "../../shared/session/template-session";
import { alignLabelElements, moveLabelElements, type LabelAlignment } from "./label-element-alignment";

export interface LabelTemplateManagerHandle {
  save(): Promise<boolean>;
}

interface Props {
  token: string;
  service?: PrinterService;
  diagnostic?: PrinterDiagnostic;
  dataTags?: DataTagCatalog;
  onDirtyChange?(dirty: boolean): void;
}

interface DragState {
  id: string;
  moved: boolean;
  startX: number;
  startY: number;
  ids: string[];
  layout: LabelTemplateLayout;
}

export const LabelTemplateManager = forwardRef<LabelTemplateManagerHandle, Props>(function LabelTemplateManager(
  { token, service, diagnostic, dataTags: suppliedDataTags, onDirtyChange },
  ref,
) {
  const dragRef = useRef<DragState | null>(null);
  const [templates, setTemplates] = useState<LabelTemplateSummary[]>([]);
  const [dataTagCatalog, setDataTagCatalog] = useState<DataTagCatalog>(suppliedDataTags || { groups: [] });
  const [source, setSource] = useState<LabelTemplate | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [defaultCopies, setDefaultCopies] = useState<number | "">(1);
  const [layout, setLayout] = useState<LabelTemplateLayout>(() => cloneLabelLayout(defaultLabelLayout));
  const [selectedIds, setSelectedIds] = useState<string[]>(["pseudonym"]);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "print" | "active" | "copy" | "delete" | "load" | null>(null);
  const [notice, setNotice] = useState<TemplateNoticeValue | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LabelTemplateSummary | null>(null);
  const [tagSearch, setTagSearch] = useState("");
  const [tagViewOptions, setTagViewOptions] = useState(readDataTagViewOptions);
  const [showTagSettings, setShowTagSettings] = useState(false);
  const [showBarcodeSource, setShowBarcodeSource] = useState(false);
  const [barcodeEditId, setBarcodeEditId] = useState<string | null>(null);
  const [restoredSession] = useState(readLabelEditorSession);
  const restorationDone = useRef(false);

  const loadTemplate = useCallback((template: LabelTemplate | null, nextCode = "") => {
    const nextLayout = template?.layout || defaultLabelLayout;
    setSource(template);
    setCode(template?.code || nextCode);
    setName(template?.name || "");
    setDescription(template?.description || "");
    setDefaultCopies(template?.defaultCopies ?? 1);
    setLayout(cloneLabelLayout(nextLayout));
    setSelectedIds(nextLayout.elements[0] ? [nextLayout.elements[0].id] : []);
    setDirty(false);
  }, []);

  const refresh = useCallback(async () => {
    const result = await fetchLabelTemplates(token);
    setTemplates(result.templates);
    setDataTagCatalog(suppliedDataTags || result.dataTags);
    return result;
  }, [suppliedDataTags, token]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void refresh()
      .then(async (result) => {
        if (!active) return;
        setTemplates(result.templates);
        if (!restorationDone.current && restoredSession) {
          const existing = restoredSession.sourceCode
            ? result.templates.find((template) => template.code === restoredSession.sourceCode)
            : null;
          if (restoredSession.sourceCode && !existing) {
            clearTemplateSession(LABEL_EDITOR_SESSION_KEY);
          } else {
            const saved = existing ? await fetchLabelTemplate(token, existing.code) : null;
            if (!active) return;
            loadTemplate(saved, saved ? "" : createUniqueLabelCode(result.templates));
            setDirty(!saved);
            setEditorOpen(true);
          }
        }
        restorationDone.current = true;
      })
      .catch((reason) => {
        if (active) setNotice({ kind: "error", text: errorText(reason, "라벨 양식을 불러오지 못했습니다.") });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      onDirtyChange?.(false);
    };
  }, [onDirtyChange, refresh, restoredSession, loadTemplate, token]);

  useEffect(() => {
    if (loading) return;
    if (!editorOpen) {
      clearTemplateSession(LABEL_EDITOR_SESSION_KEY);
      return;
    }
    persistLabelEditorSession({ sourceCode: source?.code ?? null });
  }, [loading, editorOpen, source?.code]);

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const changeLayout = useCallback((update: (current: LabelTemplateLayout) => LabelTemplateLayout) => {
    setLayout((current) => update(current));
    setDirty(true);
  }, []);

  const persistTemplate = useCallback(async (): Promise<LabelTemplate | null> => {
    if (busy) return null;
    if (!name.trim()) {
      setNotice({ kind: "error", text: "라벨 양식명을 입력해 주세요." });
      return null;
    }
    if (!Number.isInteger(defaultCopies) || Number(defaultCopies) < 1 || Number(defaultCopies) > 10) {
      setNotice({ kind: "error", text: "기본 인쇄 매수는 1~10 사이의 정수로 입력해 주세요." });
      return null;
    }
    setBusy("save");
    setNotice(null);
    try {
      const saved = await saveLabelTemplate(token, {
        code,
        name,
        description,
        defaultCopies: Number(defaultCopies),
        layout,
        active: source?.active ?? true,
      });
      setSource(saved);
      setTemplates((current) => [...current.filter((item) => item.code !== saved.code), labelSummary(saved)]);
      setDirty(false);
      setNotice({ kind: "success", text: `${saved.name} 라벨 양식을 저장했습니다.` });
      return saved;
    } catch (reason) {
      setNotice({ kind: "error", text: errorText(reason, "라벨 양식을 저장하지 못했습니다.") });
      return null;
    } finally {
      setBusy(null);
    }
  }, [busy, code, description, defaultCopies, layout, name, source?.active, token]);

  useImperativeHandle(
    ref,
    () => ({ save: async () => (!editorOpen || !dirty ? true : Boolean(await persistTemplate())) }),
    [dirty, editorOpen, persistTemplate],
  );

  function editName(value: string) {
    setName(value);
    setDirty(true);
  }

  function addElement(kind: LabelElementKind, content?: string, showText = true) {
    const element = createLabelElement(kind, Date.now());
    if (content) element.content = content;
    if (kind === "barcode") element.showText = showText;
    changeLayout((current) => ({ ...current, elements: [...current.elements, clampLabelElement(element, current)] }));
    selectElements([element.id]);
  }

  function selectElements(ids: string[]) {
    dragRef.current = null;
    setSelectedIds(ids);
  }

  function toggleElement(id: string) {
    selectElements(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id]);
  }

  function alignSelection(command: LabelAlignment) {
    const next = alignLabelElements(layout, selectedIds, command, "paper");
    if (next === layout) {
      if (command.startsWith("distribute-") && selectedIds.length >= 3) {
        setNotice({
          kind: "error",
          text: "개체가 겹쳐 있어 간격을 맞출 공간이 부족합니다. 위치나 크기를 조정해 주세요.",
        });
      }
      return;
    }
    changeLayout(() => next);
  }

  function updateSelected(patch: Partial<LabelTemplateElement>) {
    if (selectedIds.length !== 1) return;
    updateElement(selectedIds[0]!, patch);
  }

  function rotateSelection(delta: -90 | 90) {
    if (!selectedIds.length) return;
    changeLayout((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        selectedIds.includes(element.id) ? rotateLabelElement(element, delta, current) : element,
      ),
    }));
  }

  function updateElement(id: string, patch: Partial<LabelTemplateElement>) {
    changeLayout((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        element.id === id ? clampLabelElement({ ...element, ...patch }, current) : element,
      ),
    }));
  }

  function removeSelected() {
    if (!selectedIds.length) return;
    changeLayout((current) => ({
      ...current,
      elements: current.elements.filter((element) => !selectedIds.includes(element.id)),
    }));
    selectElements([]);
  }

  async function openTemplate(template: LabelTemplateSummary) {
    if (busy) return;
    setBusy("load");
    setNotice(null);
    try {
      loadTemplate(await fetchLabelTemplate(token, template.code));
      setEditorOpen(true);
    } catch (reason) {
      setNotice({ kind: "error", text: errorText(reason, "라벨 양식을 불러오지 못했습니다.") });
    } finally {
      setBusy(null);
    }
  }

  function createTemplate() {
    setNotice(null);
    loadTemplate(null, createUniqueLabelCode(templates));
    setDirty(true);
    setEditorOpen(true);
  }

  function closeEditor() {
    if (dirty && !window.confirm("저장하지 않은 변경 내용이 있습니다. 라벨 양식 목록으로 이동할까요?")) return;
    setEditorOpen(false);
    setSource(null);
    setDirty(false);
    onDirtyChange?.(false);
  }

  async function changeActive(template: LabelTemplateSummary, active: boolean) {
    if (busy) return;
    setBusy("active");
    try {
      const updated = await updateLabelTemplateActive(token, template.code, active);
      setTemplates((current) => current.map((item) => (item.code === updated.code ? labelSummary(updated) : item)));
      setNotice({ kind: "success", text: `${updated.name} 양식을 ${active ? "사용" : "미사용"} 상태로 변경했습니다.` });
    } catch (reason) {
      setNotice({ kind: "error", text: errorText(reason, "라벨 양식 사용 상태를 변경하지 못했습니다.") });
    } finally {
      setBusy(null);
    }
  }

  async function copyTemplate(template: LabelTemplateSummary) {
    if (busy) return;
    setBusy("copy");
    try {
      const copied = await saveLabelTemplate(token, {
        code: createUniqueLabelCode(templates),
        name: createUniqueLabelName(template.name, templates),
        description: template.description || "",
        defaultCopies: template.defaultCopies ?? 1,
        layout: cloneLabelLayout((await fetchLabelTemplate(token, template.code)).layout),
        active: false,
      });
      setTemplates((current) => [...current, labelSummary(copied)]);
      setNotice({ kind: "success", text: `${copied.name}을 미사용 상태로 만들었습니다.` });
    } catch (reason) {
      setNotice({ kind: "error", text: errorText(reason, "라벨 양식을 복사하지 못했습니다.") });
    } finally {
      setBusy(null);
    }
  }

  async function removeTemplate(template: LabelTemplateSummary) {
    if (busy) return false;
    setBusy("delete");
    try {
      await deleteLabelTemplate(token, template.code);
      setTemplates((current) => current.filter((item) => item.code !== template.code));
      setDeleteTarget(null);
      setNotice({ kind: "success", text: `${template.name} 라벨 양식을 삭제했습니다.` });
      return true;
    } catch (reason) {
      setNotice({ kind: "error", text: errorText(reason, "라벨 양식을 삭제하지 못했습니다.") });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function printTestLabel() {
    if (busy) return;
    setBusy("print");
    setNotice(null);
    try {
      const result = await previewLabelTemplate(token, layout);
      if (!service) throw new Error("프린터 연결 정보를 확인할 수 없습니다.");
      let printer = diagnostic?.printer ?? null;
      if (!printer) {
        const discovery = await service.discover();
        printer = discovery.diagnostic.printer;
        if (!printer) throw new Error(discovery.diagnostic.message);
      }
      await service.sendRaw(printer, result.samplePayload);
      setNotice({ kind: "success", text: "현재 라벨 양식의 샘플을 프린터로 전송했습니다." });
    } catch (reason) {
      setNotice({
        kind: "error",
        text: errorText(reason, "테스트 출력에 실패했습니다."),
      });
    } finally {
      setBusy(null);
    }
  }

  const selected =
    selectedIds.length === 1 ? layout.elements.find((element) => element.id === selectedIds[0]) || null : null;
  const decoratedDataTags = useMemo(
    () => updateTagExamples(decorateCatalog(dataTagCatalog), layout.sampleData || {}),
    [dataTagCatalog, layout.sampleData],
  );
  const dataTagGroups = useMemo(() => groupDataTags(decoratedDataTags), [decoratedDataTags]);
  const flatDataTags = useMemo(() => flattenLabelDataTags(decoratedDataTags), [decoratedDataTags]);
  const normalizedTagSearch = tagSearch.trim().toLowerCase();
  const visibleTagGroups = useMemo(
    () =>
      dataTagGroups
        .map((group) => ({
          ...group,
          tags: group.tags.filter((tag) => dataTagMatchesSearch(tag, group.label, normalizedTagSearch)),
        }))
        .filter((group) => group.tags.length > 0),
    [dataTagGroups, normalizedTagSearch],
  );

  if (loading) return <div className="admin-view-loading">라벨 편집기를 준비하고 있습니다.</div>;

  if (!editorOpen) {
    return (
      <>
        <section className="examlist-template-library label-template-library">
          <header className="admin-view-heading">
            <div>
              <h2>라벨 양식 관리</h2>
              <p>전형별 라벨 출력에 사용할 양식을 만들고 관리합니다.</p>
            </div>
            <div className="admin-view-actions">
              <span className="count-badge">총 {templates.length}건</span>
              <button className="exam-outline-button" onClick={() => void refresh()} disabled={Boolean(busy)}>
                <RefreshButtonIcon />
                <span>새로고침</span>
              </button>
              <button className="exam-primary-button" onClick={createTemplate}>
                <AddButtonIcon />
                <span>새 양식</span>
              </button>
            </div>
          </header>
          {notice && <TemplateNotice notice={notice} onClose={() => setNotice(null)} />}
          <div className="exam-template-card-grid">
            {templates.map((template) => (
              <article className="exam-template-card label-template-card" key={template.id}>
                <div className="exam-template-card-copy">
                  <div className="template-card-title-row">
                    <div className="template-card-meta-row template-card-meta-row-name">
                      <h3>{template.name}</h3>
                    </div>
                  </div>
                  <div className="template-card-meta-row template-card-meta-row-description">
                    <p>{template.description || "설명 없음"}</p>
                  </div>
                </div>
                <div className="exam-template-preview label-template-card-preview" aria-hidden="true">
                  <LabelTemplateThumbnail template={template} />
                </div>
                <footer>
                  <label className={`template-card-status-switch ${template.active ? "active" : ""}`}>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={template.active}
                      disabled={Boolean(busy)}
                      aria-label={`${template.name} 사용 여부`}
                      onChange={(event) => void changeActive(template, event.target.checked)}
                    />
                    <i aria-hidden="true" />
                    <span>{template.active ? "사용" : "미사용"}</span>
                  </label>
                  <div className="template-card-actions">
                    <button
                      className="exam-outline-button compact template-card-delete-button"
                      disabled={Boolean(busy)}
                      onClick={() => setDeleteTarget(template)}
                    >
                      <DeleteButtonIcon />
                      <span>삭제</span>
                    </button>
                    <button
                      className="exam-outline-button compact"
                      disabled={Boolean(busy)}
                      onClick={() => void copyTemplate(template)}
                    >
                      <CopyButtonIcon />
                      <span>{busy === "copy" ? "복사 중…" : "복사"}</span>
                    </button>
                    <button
                      className="exam-primary-button"
                      disabled={Boolean(busy)}
                      onClick={() => void openTemplate(template)}
                    >
                      <EditButtonIcon />
                      <span>수정</span>
                    </button>
                  </div>
                </footer>
              </article>
            ))}
            {templates.length === 0 && (
              <div className="admin-view-empty">
                <p>등록된 라벨 양식이 없습니다.</p>
                <button className="exam-primary-button" onClick={createTemplate}>
                  <AddButtonIcon />
                  <span>첫 양식 만들기</span>
                </button>
              </div>
            )}
          </div>
        </section>
        {deleteTarget && (
          <TemplateDeleteModal
            template={deleteTarget}
            onClose={() => setDeleteTarget(null)}
            onDelete={() => removeTemplate(deleteTarget)}
          />
        )}
      </>
    );
  }

  return (
    <section className="label-template-manager">
      <h2 className="label-editor-accessible-title">라벨 양식 편집</h2>
      <TemplateEditorMetadataBar
        name={name}
        description={description}
        onNameChange={editName}
        onDescriptionChange={(value) => {
          setDescription(value);
          setDirty(true);
        }}
      >
        <button
          className="exam-outline-button template-editor-list-button"
          onClick={closeEditor}
          disabled={Boolean(busy)}
        >
          <ListButtonIcon />
          <span>양식 목록</span>
        </button>
        <button
          className="exam-ghost-button template-editor-preview-button"
          onClick={() => void printTestLabel()}
          disabled={Boolean(busy)}
        >
          <PreviewButtonIcon />
          <span>{busy === "print" ? "전송 중…" : "테스트 출력"}</span>
        </button>
        <button
          className="exam-primary-button template-editor-save-button"
          onClick={() => void persistTemplate()}
          disabled={Boolean(busy) || !dirty}
        >
          <SaveButtonIcon />
          <span>{busy === "save" ? "저장 중…" : "저장"}</span>
        </button>
      </TemplateEditorMetadataBar>

      {notice && <TemplateNotice notice={notice} onClose={() => setNotice(null)} />}

      <div className="label-template-workspace">
        <aside
          className="label-template-tools label-template-properties examlist-template-editor"
          aria-label="에디터 툴바"
        >
          <h3 className="label-editor-accessible-title">에디터 툴바</h3>
          <LabelTextFormatting key={selected?.id ?? "no-selection"} element={selected} onChange={updateSelected} />
          <div className="template-toolbar-section label-insert-section">
            <span className="template-toolbar-section-label">삽입</span>
            <div className="template-toolbar-group-controls">
              <button
                className="template-tool-button icon-only"
                aria-label="텍스트"
                title="텍스트"
                onClick={() => addElement("text")}
              >
                <b aria-hidden="true">T</b>
              </button>
              <button
                className="template-tool-button icon-only"
                aria-label="바코드"
                title="바코드"
                onClick={() => {
                  setBarcodeEditId(null);
                  setShowBarcodeSource(true);
                }}
              >
                <svg className="template-tool-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4 6v12M7 4v16M10 6v12M13 4v16M17 6v12M20 4v16" />
                </svg>
              </button>
              <button
                className="template-tool-button icon-only"
                aria-label="선"
                title="선"
                onClick={() => addElement("line")}
              >
                <svg className="template-tool-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4 12h16" />
                </svg>
              </button>
              <button
                className="template-tool-button icon-only"
                aria-label="사각형"
                title="사각형"
                onClick={() => addElement("box")}
              >
                <svg className="template-tool-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="4" y="5" width="16" height="14" rx="1" />
                </svg>
              </button>
            </div>
          </div>
          <div className="label-property-divider" />
          <h3 className="label-editor-accessible-title">선택 요소</h3>
          <div className="template-toolbar-group-label label-object-heading">개체 편집</div>
          <div className="template-toolbar-section examlist-object-size-control">
            <span className="template-toolbar-section-label">크기</span>
            <div className="examlist-object-size-grid">
              <LabelObjectNumberField
                label="가로"
                name="너비(mm)"
                value={selected?.widthMm}
                min={0.5}
                max={selected?.rotation === 90 || selected?.rotation === 270 ? layout.heightMm : layout.widthMm}
                onChange={(widthMm) => updateSelected({ widthMm })}
              />
              <LabelObjectNumberField
                label="세로"
                name="높이(mm)"
                value={selected?.heightMm}
                min={0.5}
                max={selected?.rotation === 90 || selected?.rotation === 270 ? layout.widthMm : layout.heightMm}
                onChange={(heightMm) => updateSelected({ heightMm })}
              />
            </div>
          </div>
          <div className="template-toolbar-section examlist-object-size-control">
            <span className="template-toolbar-section-label">위치</span>
            <div className="examlist-object-size-grid">
              <LabelObjectNumberField
                label="X"
                name="X(mm)"
                value={selected?.xMm}
                min={0}
                max={layout.widthMm}
                onChange={(xMm) => updateSelected({ xMm })}
              />
              <LabelObjectNumberField
                label="Y"
                name="Y(mm)"
                value={selected?.yMm}
                min={0}
                max={layout.heightMm}
                onChange={(yMm) => updateSelected({ yMm })}
              />
            </div>
          </div>
          <div className="template-toolbar-section">
            <span className="template-toolbar-section-label">회전</span>
            <div className="examlist-object-align-grid">
              {([-90, 90] as const).map((delta) => (
                <button
                  key={delta}
                  type="button"
                  className="template-toolbar-icon-select-button"
                  aria-label={`${delta < 0 ? "반시계" : "시계"} 방향 90도 회전`}
                  title={`${delta < 0 ? "반시계" : "시계"} 방향 90도 회전`}
                  disabled={selectedIds.length === 0}
                  onClick={() => rotateSelection(delta)}
                >
                  <svg className="template-tool-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <g transform={delta < 0 ? "translate(24 0) scale(-1 1)" : undefined}>
                      <path d="M20 4v6h-6M20 10a8 8 0 1 0 0 5" />
                    </g>
                  </svg>
                  <span>{delta < 0 ? "반시계" : "시계"}</span>
                </button>
              ))}
            </div>
          </div>
          <NumberField
            label="선 굵기(mm)"
            value={selected?.kind === "line" || selected?.kind === "box" ? (selected.strokeWidthMm ?? 0.4) : undefined}
            min={0.1}
            max={5}
            step={0.1}
            onChange={(strokeWidthMm) => updateSelected({ strokeWidthMm })}
          />
          <LabelObjectAlignment count={selectedIds.length} onAlign={alignSelection} />
        </aside>
        <aside className="label-template-toolbox" aria-label="데이터 태그">
          <div className="editor-tag-panel-block label-template-data-tags examlist-template-editor">
            <div className="template-tag-panel-heading">
              <p className="template-tag-caption">데이터 태그</p>
              <button
                className="icon-button template-tag-sample-settings-button"
                type="button"
                title="데이터 태그 설정"
                aria-label="데이터 태그 설정"
                onClick={() => setShowTagSettings(true)}
              >
                <svg className="button-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
                  <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.36a1.7 1.7 0 0 0-1 .24 1.7 1.7 0 0 0-.82 1.46V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.36 19.45 1.7 1.7 0 0 0 7 19.2a1.7 1.7 0 0 0-.87.52l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3.64 15a1.7 1.7 0 0 0-.24-1 1.7 1.7 0 0 0-1.46-.82H2a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 3.55 8.36 1.7 1.7 0 0 0 3.8 7a1.7 1.7 0 0 0-.52-.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8 3.64a1.7 1.7 0 0 0 1-.24 1.7 1.7 0 0 0 .82-1.46V2a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 14.64 3.55 1.7 1.7 0 0 0 16 3.8a1.7 1.7 0 0 0 .87-.52l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06A1.7 1.7 0 0 0 19.36 8c.09.35.09.7 0 1a1.7 1.7 0 0 0 1.46.82H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.45 14.64c-.02.12-.04.24-.05.36Z" />
                </svg>
              </button>
            </div>
            <div className="template-tag-strip editor-tag-catalog">
              <label className="template-tag-search">
                <span className="template-tag-search-icon" aria-hidden="true" />
                <input
                  type="search"
                  placeholder="태그 검색..."
                  autoComplete="off"
                  value={tagSearch}
                  onChange={(event) => setTagSearch(event.target.value)}
                />
              </label>
              <div className="template-tag-view-options" aria-label="캔버스 데이터태그 표시 옵션">
                <TagViewSwitch
                  label="아이콘 표시"
                  checked={tagViewOptions.showIcons}
                  onChange={(showIcons) =>
                    setTagViewOptions((current) => saveTagViewOptions({ ...current, showIcons }))
                  }
                />
                <TagViewSwitch
                  label="샘플데이터로 표시"
                  checked={tagViewOptions.showSampleData}
                  onChange={(showSampleData) =>
                    setTagViewOptions((current) => saveTagViewOptions({ ...current, showSampleData }))
                  }
                />
              </div>
              <div className="template-tag-accordion">
                {visibleTagGroups.map((group) => (
                  <details
                    className="template-tag-accordion-group"
                    key={group.id}
                    open={normalizedTagSearch ? true : undefined}
                  >
                    <summary className="template-tag-accordion-summary">
                      <span className="template-tag-group-heading">
                        <span
                          className="template-tag-group-icon"
                          dangerouslySetInnerHTML={{ __html: renderProjectDataTagIcon(group.icon) }}
                        />
                        <span className="template-tag-group-label">{group.label}</span>
                        <span className="template-tag-group-count">{group.tags.length}</span>
                      </span>
                      <span className="template-tag-group-chevron" aria-hidden="true" />
                    </summary>
                    <div className="template-tag-accordion-list">
                      {group.tags.map((tag) => {
                        const key = String(tag.key || tag.dataKey || "");
                        const label = String(tag.label || key);
                        const example = String(tag.example ?? "");
                        return (
                          <button
                            className="template-tag-button template-tag-accordion-button"
                            type="button"
                            key={key}
                            title={[label, example].filter(Boolean).join(" · ")}
                            aria-label={[label, example].filter(Boolean).join(" · ")}
                            onClick={() => addElement("text", `{{${key}}}`)}
                          >
                            <span
                              className="template-tag-button-icon"
                              dangerouslySetInnerHTML={{ __html: renderProjectDataTagIcon(group.icon) }}
                            />
                            <span className="template-tag-button-label">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </details>
                ))}
              </div>
              {visibleTagGroups.length === 0 && (
                <p className="editor-empty template-tag-search-empty">검색 결과가 없습니다.</p>
              )}
            </div>
          </div>
        </aside>

        <main
          className="label-template-stage"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) selectElements([]);
          }}
        >
          <div className="label-template-ruler">
            {layout.widthMm} × {layout.heightMm}mm · {layout.dpi}dpi
          </div>
          <div
            className="label-template-canvas"
            tabIndex={0}
            aria-label="라벨 용지"
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.defaultPrevented) return;
              if (
                ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) &&
                selectedIds.length > 0 &&
                !event.metaKey &&
                !event.altKey
              ) {
                event.preventDefault();
                const step = event.ctrlKey ? 0.1 : 1;
                const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
                const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
                const next = moveLabelElements(layout, selectedIds, dx, dy);
                if (next !== layout) changeLayout(() => next);
              } else if (event.key === "Delete") {
                event.preventDefault();
                removeSelected();
                event.currentTarget.focus({ preventScroll: true });
              } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
                event.preventDefault();
                selectElements(layout.elements.map((element) => element.id));
              } else if (event.key === "Escape") {
                selectElements([]);
              }
            }}
            style={{ aspectRatio: `${layout.widthMm} / ${layout.heightMm}` }}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) selectElements([]);
            }}
          >
            {layout.elements.map((element, index) => (
              <div
                key={element.id}
                className={`label-canvas-element ${element.kind} ${selectedIds.includes(element.id) ? "selected" : ""}`}
                role="button"
                tabIndex={0}
                aria-label={`개체 ${index + 1}: ${element.content || (element.kind === "line" ? "선" : "사각형")}`}
                aria-pressed={selectedIds.includes(element.id)}
                title={element.kind === "barcode" ? "두 번 클릭하여 바코드 데이터와 값 표시 설정" : undefined}
                onDoubleClick={() => {
                  if (element.kind !== "barcode") return;
                  selectElements([element.id]);
                  setBarcodeEditId(element.id);
                  setShowBarcodeSource(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (event.shiftKey || event.ctrlKey || event.metaKey) toggleElement(element.id);
                    else selectElements([element.id]);
                  }
                }}
                style={{
                  left: `${(element.xMm / layout.widthMm) * 100}%`,
                  top: `${(element.yMm / layout.heightMm) * 100}%`,
                  width: `${(element.widthMm / layout.widthMm) * 100}%`,
                  height: `${(element.heightMm / layout.heightMm) * 100}%`,
                  transform: labelElementTransform(element.rotation),
                  transformOrigin: "top left",
                  ...(element.kind === "text"
                    ? {
                        fontSize: `${Math.max(9, (element.fontSizeMm ?? 3) * 3.2)}px`,
                        justifyContent:
                          element.align === "center" ? "center" : element.align === "right" ? "flex-end" : "flex-start",
                      }
                    : {}),
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  event.currentTarget.focus({ preventScroll: true });
                  if (event.shiftKey || event.ctrlKey || event.metaKey) {
                    toggleElement(element.id);
                    return;
                  }
                  const ids = selectedIds.includes(element.id) ? selectedIds : [element.id];
                  if (!selectedIds.includes(element.id)) selectElements(ids);
                  event.currentTarget.setPointerCapture(event.pointerId);
                  dragRef.current = {
                    id: element.id,
                    moved: false,
                    startX: event.clientX,
                    startY: event.clientY,
                    ids,
                    layout,
                  };
                }}
                onPointerMove={(event) => {
                  const drag = dragRef.current;
                  if (!drag || drag.id !== element.id || !event.currentTarget.hasPointerCapture(event.pointerId))
                    return;
                  const canvas = event.currentTarget.parentElement?.getBoundingClientRect();
                  if (!canvas) return;
                  if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 3) return;
                  drag.moved = true;
                  changeLayout(() =>
                    moveLabelElements(
                      drag.layout,
                      drag.ids,
                      ((event.clientX - drag.startX) / canvas.width) * layout.widthMm,
                      ((event.clientY - drag.startY) / canvas.height) * layout.heightMm,
                    ),
                  );
                }}
                onPointerUp={() => {
                  dragRef.current = null;
                }}
                onPointerCancel={() => {
                  dragRef.current = null;
                }}
                onLostPointerCapture={() => {
                  dragRef.current = null;
                }}
              >
                {element.kind === "text" && (
                  <LabelElementPreview
                    content={element.content || "텍스트"}
                    tags={flatDataTags}
                    groups={dataTagGroups}
                    showIcons={tagViewOptions.showIcons}
                    showSamples={tagViewOptions.showSampleData}
                  />
                )}
                {element.kind === "barcode" && (
                  <>
                    <i />
                    <small>
                      {element.showText === false
                        ? ""
                        : replaceLabelSamples(element.content || "", flatDataTags, tagViewOptions.showSampleData)}
                    </small>
                  </>
                )}
              </div>
            ))}
          </div>
          <p>
            방향키 1mm 이동 · Ctrl+방향키 0.1mm 이동 · Shift/Ctrl 클릭 다중 선택 · Ctrl+A 전체 선택 · Esc 선택 해제 ·
            Delete 삭제
          </p>
        </main>

        <aside className="label-template-paper label-template-properties" aria-label="용지 설정">
          <h3>용지 설정</h3>
          <div className="label-property-row">
            <NumberField
              label="너비(mm)"
              value={layout.widthMm}
              min={20}
              max={200}
              step={1}
              onChange={(widthMm) => changeLayout((current) => resizeLayout(current, { widthMm }))}
            />
            <NumberField
              label="높이(mm)"
              value={layout.heightMm}
              min={10}
              max={150}
              step={1}
              onChange={(heightMm) => changeLayout((current) => resizeLayout(current, { heightMm }))}
            />
          </div>
          <label>
            해상도
            <select
              value={layout.dpi}
              onChange={(event) =>
                changeLayout((current) => ({ ...current, dpi: Number(event.target.value) as 203 | 300 }))
              }
            >
              <option value={203}>203 dpi</option>
              <option value={300}>300 dpi</option>
            </select>
          </label>

          <label>
            기본 인쇄 매수
            <input
              type="number"
              min={1}
              max={10}
              step={1}
              value={defaultCopies}
              disabled={Boolean(busy)}
              onChange={(event) => {
                setDefaultCopies(event.target.value === "" ? "" : Number(event.target.value));
                setDirty(true);
              }}
            />
          </label>
          <p className="label-property-empty">1~10매 · 사용자 화면에서 출력 매수를 변경할 수 있습니다.</p>
        </aside>
      </div>

      {showBarcodeSource && (
        <BarcodeSourcePicker
          catalog={decoratedDataTags}
          showValueOption
          initialShowText={layout.elements.find((element) => element.id === barcodeEditId)?.showText !== false}
          onClose={() => setShowBarcodeSource(false)}
          onSelect={(key, showText) => {
            if (barcodeEditId) updateElement(barcodeEditId, { content: `{{${key}}}`, showText });
            else addElement("barcode", `{{${key}}}`, showText);
          }}
        />
      )}
      {showTagSettings && (
        <DataTagSettingsModal
          catalog={decoratedDataTags}
          onClose={() => setShowTagSettings(false)}
          onSave={(examples) => {
            changeLayout((current) => ({ ...current, sampleData: examples }));
            setShowTagSettings(false);
          }}
        />
      )}
    </section>
  );
});

function NumberField({
  label,
  value,
  min,
  max,
  step = 0.1,
  onChange,
}: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  step?: number;
  onChange(value: number): void;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        value={value ?? ""}
        placeholder="-"
        disabled={value === undefined}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const nextValue = Number(event.target.value);
          if (Number.isFinite(nextValue)) onChange(nextValue);
        }}
      />
    </label>
  );
}

function TagViewSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className="template-tag-view-switch">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="template-tag-view-switch-track" aria-hidden="true" />
      <span className="template-tag-view-switch-label">{label}</span>
    </label>
  );
}

function LabelElementPreview({
  content,
  tags,
  groups,
  showIcons,
  showSamples,
}: {
  content: string;
  tags: DataTagDefinition[];
  groups: ReturnType<typeof groupDataTags>;
  showIcons: boolean;
  showSamples: boolean;
}) {
  const exactTagKey = /^\{\{([^{}]+)\}\}$/.exec(content)?.[1];
  const definition = exactTagKey ? tags.find((tag) => String(tag.key || tag.dataKey || "") === exactTagKey) : undefined;
  const group = exactTagKey
    ? groups.find((item) => item.tags.some((tag) => String(tag.key || tag.dataKey || "") === exactTagKey))
    : undefined;
  return (
    <>
      {definition && showIcons && (
        <span
          className="label-canvas-tag-icon"
          dangerouslySetInnerHTML={{ __html: renderProjectDataTagIcon(group?.icon || "more") }}
        />
      )}
      <span>{replaceLabelSamples(content, tags, showSamples)}</span>
    </>
  );
}

function dataTagMatchesSearch(tag: DataTagDefinition, groupLabel: string, search: string) {
  if (!search) return true;
  return [
    groupLabel,
    tag.key,
    tag.dataKey,
    tag.token,
    tag.label,
    tag.example,
    ...(Array.isArray(tag.aliases) ? tag.aliases : []),
  ]
    .join(" ")
    .toLowerCase()
    .includes(search);
}

function saveTagViewOptions(options: { showIcons: boolean; showSampleData: boolean }) {
  try {
    window.localStorage.setItem("examcheck.templateEditor.dataTagViewOptions", JSON.stringify(options));
  } catch {
    // 저장소가 차단되어도 현재 편집 화면에는 즉시 반영됩니다.
  }
  return options;
}

function resizeLayout(layout: LabelTemplateLayout, patch: Partial<Pick<LabelTemplateLayout, "widthMm" | "heightMm">>) {
  const next = { ...layout, ...patch };
  return { ...next, elements: next.elements.map((element) => clampLabelElement(element, next)) };
}

function LabelTemplateThumbnail({ template }: { template: LabelTemplateSummary }) {
  return (
    <div
      className="preview-paper label-template-preview-paper"
      style={{ aspectRatio: `${template.thumbnail.widthMm} / ${template.thumbnail.heightMm}` }}
    >
      {template.thumbnail.elements.map((element) => (
        <span
          key={element.id}
          className={`label-template-thumbnail-element ${element.kind}`}
          style={{
            left: `${(element.xMm / template.thumbnail.widthMm) * 100}%`,
            top: `${(element.yMm / template.thumbnail.heightMm) * 100}%`,
            width: `${(element.widthMm / template.thumbnail.widthMm) * 100}%`,
            height: `${(element.heightMm / template.thumbnail.heightMm) * 100}%`,
            transform: labelElementTransform(element.rotation),
            transformOrigin: "top left",
          }}
        >
          {element.kind === "text" ? element.content?.replace(/\{\{[^{}]+\}\}/g, "데이터") : ""}
        </span>
      ))}
    </div>
  );
}

function createUniqueLabelCode(templates: readonly LabelTemplateSummary[], now = Date.now()) {
  const used = new Set(templates.map((template) => template.code));
  const base = `LABEL_${Math.max(0, Math.trunc(now)).toString(36).toUpperCase()}`;
  if (!used.has(base)) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const code = `${base}_${index}`;
    if (!used.has(code)) return code;
  }
  throw new Error("새 라벨 양식 코드를 자동으로 만들 수 없습니다.");
}

function createUniqueLabelName(sourceName: string, templates: readonly LabelTemplateSummary[]) {
  const used = new Set(templates.map((template) => template.name));
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? " 복사본" : ` 복사본 ${index}`;
    const name = `${sourceName.slice(0, 200 - suffix.length)}${suffix}`;
    if (!used.has(name)) return name;
  }
  throw new Error("라벨 양식 복사본 이름을 만들 수 없습니다.");
}

function errorText(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

function labelSummary(template: LabelTemplate): LabelTemplateSummary {
  const { layout, zplTemplate: _payload, ...summary } = template;
  return { ...summary, thumbnail: { widthMm: layout.widthMm, heightMm: layout.heightMm, elements: layout.elements } };
}
