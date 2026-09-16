import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { DataTagCatalog, DataTagDefinition } from "../../shared/templates/template-editor-contracts";
import type { PrinterService } from "../printer/PrinterService";
import type { PrinterDiagnostic } from "../printer/printer.types";
import {
  deleteLabelTemplate,
  fetchLabelTemplates,
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
  replaceLabelSamples,
} from "./label-template-model";
import { updateTagExamples } from "./template-manager-model";

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
  startX: number;
  startY: number;
  originalX: number;
  originalY: number;
}

export const LabelTemplateManager = forwardRef<LabelTemplateManagerHandle, Props>(function LabelTemplateManager(
  { token, service, diagnostic, dataTags: suppliedDataTags, onDirtyChange },
  ref,
) {
  const dragRef = useRef<DragState | null>(null);
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [dataTagCatalog, setDataTagCatalog] = useState<DataTagCatalog>(suppliedDataTags || { groups: [] });
  const [source, setSource] = useState<LabelTemplate | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [defaultCopies, setDefaultCopies] = useState<number | "">(1);
  const [layout, setLayout] = useState<LabelTemplateLayout>(() => cloneLabelLayout(defaultLabelLayout));
  const [selectedId, setSelectedId] = useState<string | null>("pseudonym");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "preview" | "print" | "active" | "copy" | "delete" | null>(null);
  const [notice, setNotice] = useState<TemplateNoticeValue | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LabelTemplate | null>(null);
  const [zplTemplate, setZplTemplate] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [tagViewOptions, setTagViewOptions] = useState(readDataTagViewOptions);
  const [showTagSettings, setShowTagSettings] = useState(false);

  const loadTemplate = useCallback((template: LabelTemplate | null, nextCode = "") => {
    const nextLayout = template?.layout || defaultLabelLayout;
    setSource(template);
    setCode(template?.code || nextCode);
    setName(template?.name || "");
    setDescription(template?.description || "");
    setDefaultCopies(template?.defaultCopies ?? 1);
    setLayout(cloneLabelLayout(nextLayout));
    setSelectedId(nextLayout.elements[0]?.id ?? null);
    setZplTemplate(template?.zplTemplate || "");
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
      .then((result) => {
        if (!active) return;
        setTemplates(result.templates);
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
  }, [onDirtyChange, refresh]);

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const changeLayout = useCallback((update: (current: LabelTemplateLayout) => LabelTemplateLayout) => {
    setLayout((current) => update(current));
    setDirty(true);
    setZplTemplate("");
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
      const result = await refresh();
      setSource(saved);
      setTemplates(result.templates);
      setDirty(false);
      setZplTemplate(saved.zplTemplate);
      setNotice({ kind: "success", text: `${saved.name} 라벨 양식을 저장했습니다.` });
      return saved;
    } catch (reason) {
      setNotice({ kind: "error", text: errorText(reason, "라벨 양식을 저장하지 못했습니다.") });
      return null;
    } finally {
      setBusy(null);
    }
  }, [busy, code, description, defaultCopies, layout, name, refresh, source?.active, token]);

  useImperativeHandle(
    ref,
    () => ({ save: async () => (!editorOpen || !dirty ? true : Boolean(await persistTemplate())) }),
    [dirty, editorOpen, persistTemplate],
  );

  function editName(value: string) {
    setName(value);
    setDirty(true);
  }

  function addElement(kind: LabelElementKind, content?: string) {
    const element = createLabelElement(kind, Date.now());
    if (content) element.content = content;
    changeLayout((current) => ({ ...current, elements: [...current.elements, clampLabelElement(element, current)] }));
    setSelectedId(element.id);
  }

  function updateSelected(patch: Partial<LabelTemplateElement>) {
    if (!selectedId) return;
    updateElement(selectedId, patch);
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
    if (!selectedId) return;
    changeLayout((current) => ({
      ...current,
      elements: current.elements.filter((element) => element.id !== selectedId),
    }));
    setSelectedId(null);
  }

  function openTemplate(template: LabelTemplate) {
    setNotice(null);
    loadTemplate(template);
    setEditorOpen(true);
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

  async function changeActive(template: LabelTemplate, active: boolean) {
    if (busy) return;
    setBusy("active");
    try {
      const updated = await updateLabelTemplateActive(token, template.code, active);
      setTemplates((current) => current.map((item) => (item.code === updated.code ? updated : item)));
      setNotice({ kind: "success", text: `${updated.name} 양식을 ${active ? "사용" : "미사용"} 상태로 변경했습니다.` });
    } catch (reason) {
      setNotice({ kind: "error", text: errorText(reason, "라벨 양식 사용 상태를 변경하지 못했습니다.") });
    } finally {
      setBusy(null);
    }
  }

  async function copyTemplate(template: LabelTemplate) {
    if (busy) return;
    setBusy("copy");
    try {
      const copied = await saveLabelTemplate(token, {
        code: createUniqueLabelCode(templates),
        name: createUniqueLabelName(template.name, templates),
        description: template.description || "",
        defaultCopies: template.defaultCopies ?? 1,
        layout: cloneLabelLayout(template.layout),
        active: false,
      });
      setTemplates((current) => [...current, copied]);
      setNotice({ kind: "success", text: `${copied.name}을 미사용 상태로 만들었습니다.` });
    } catch (reason) {
      setNotice({ kind: "error", text: errorText(reason, "라벨 양식을 복사하지 못했습니다.") });
    } finally {
      setBusy(null);
    }
  }

  async function removeTemplate(template: LabelTemplate) {
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

  async function preview(testPrint = false) {
    if (busy) return;
    setBusy(testPrint ? "print" : "preview");
    setNotice(null);
    try {
      const result = await previewLabelTemplate(token, layout);
      setZplTemplate(result.zplTemplate);
      setAdvancedOpen(true);
      if (testPrint) {
        if (!service) throw new Error("프린터 연결 정보를 확인할 수 없습니다.");
        let printer = diagnostic?.printer ?? null;
        if (!printer) {
          const discovery = await service.discover();
          printer = discovery.diagnostic.printer;
          if (!printer) throw new Error(discovery.diagnostic.message);
        }
        await service.sendRaw(printer, result.samplePayload);
        setNotice({ kind: "success", text: "현재 라벨 양식의 샘플을 프린터로 전송했습니다." });
      }
    } catch (reason) {
      setNotice({
        kind: "error",
        text: errorText(reason, testPrint ? "테스트 출력에 실패했습니다." : "미리보기를 만들지 못했습니다."),
      });
    } finally {
      setBusy(null);
    }
  }

  const selected = layout.elements.find((element) => element.id === selectedId) || null;
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
  const sample = Object.fromEntries(flatDataTags.map((tag) => [String(tag.key || ""), String(tag.example ?? "")]));

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
                      onClick={() => openTemplate(template)}
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
      <header className="label-template-heading">
        <div>
          <p>LABEL TEMPLATE</p>
          <h2>라벨 양식 편집</h2>
        </div>
        <div className="label-template-actions">
          <button className="exam-outline-button" onClick={closeEditor} disabled={Boolean(busy)}>
            양식 목록
          </button>
          <button className="exam-outline-button" onClick={() => void preview(true)} disabled={Boolean(busy)}>
            {busy === "print" ? "전송 중…" : "테스트 출력"}
          </button>
          <button
            className="exam-primary-button"
            onClick={() => void persistTemplate()}
            disabled={Boolean(busy) || !dirty}
          >
            {busy === "save" ? "저장 중…" : "저장"}
          </button>
        </div>
      </header>

      {notice && <TemplateNotice notice={notice} onClose={() => setNotice(null)} />}

      <div className="label-template-workspace">
        <aside className="label-template-toolbox">
          <h3>삽입</h3>
          <div className="label-template-tool-grid">
            <button onClick={() => addElement("text")}>
              <b>T</b>
              <span>텍스트</span>
            </button>
            <button onClick={() => addElement("barcode")}>
              <b>▥</b>
              <span>바코드</span>
            </button>
            <button onClick={() => addElement("line")}>
              <b>―</b>
              <span>선</span>
            </button>
            <button onClick={() => addElement("box")}>
              <b>□</b>
              <span>사각형</span>
            </button>
          </div>
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
            if (event.target === event.currentTarget) setSelectedId(null);
          }}
        >
          <div className="label-template-ruler">
            {layout.widthMm} × {layout.heightMm}mm · {layout.dpi}dpi
          </div>
          <div
            className="label-template-canvas"
            style={{ aspectRatio: `${layout.widthMm} / ${layout.heightMm}` }}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setSelectedId(null);
            }}
          >
            {layout.elements.map((element) => (
              <div
                key={element.id}
                className={`label-canvas-element ${element.kind} ${selectedId === element.id ? "selected" : ""}`}
                style={{
                  left: `${(element.xMm / layout.widthMm) * 100}%`,
                  top: `${(element.yMm / layout.heightMm) * 100}%`,
                  width: `${(element.widthMm / layout.widthMm) * 100}%`,
                  height: `${(element.heightMm / layout.heightMm) * 100}%`,
                  ...(element.kind === "text"
                    ? {
                        fontSize: `${Math.max(9, (element.fontSizeMm ?? 3) * 3.2)}px`,
                        justifyContent:
                          element.align === "center" ? "center" : element.align === "right" ? "flex-end" : "flex-start",
                      }
                    : {}),
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setSelectedId(element.id);
                  dragRef.current = {
                    id: element.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    originalX: element.xMm,
                    originalY: element.yMm,
                  };
                }}
                onPointerMove={(event) => {
                  const drag = dragRef.current;
                  if (!drag || drag.id !== element.id || !event.currentTarget.hasPointerCapture(event.pointerId))
                    return;
                  const canvas = event.currentTarget.parentElement?.getBoundingClientRect();
                  if (!canvas) return;
                  updateElement(element.id, {
                    xMm: drag.originalX + ((event.clientX - drag.startX) / canvas.width) * layout.widthMm,
                    yMm: drag.originalY + ((event.clientY - drag.startY) / canvas.height) * layout.heightMm,
                  });
                }}
                onPointerUp={() => {
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
          <p>요소를 드래그하여 이동하고 우측 속성에서 크기와 표시 방식을 조정하세요.</p>
        </main>

        <aside className="label-template-properties">
          <h3>라벨 속성</h3>
          <label>
            양식명
            <input value={name} maxLength={200} onChange={(event) => editName(event.target.value)} />
          </label>
          <label>
            설명
            <input
              value={description}
              maxLength={500}
              placeholder="라벨 양식 설명을 입력하세요."
              onChange={(event) => {
                setDescription(event.target.value);
                setDirty(true);
              }}
            />
          </label>
          <div className="label-property-row">
            <NumberField
              label="너비(mm)"
              value={layout.widthMm}
              min={20}
              max={200}
              onChange={(widthMm) => changeLayout((current) => resizeLayout(current, { widthMm }))}
            />
            <NumberField
              label="높이(mm)"
              value={layout.heightMm}
              min={10}
              max={150}
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

          <div className="label-property-divider" />
          <h3>선택 요소</h3>
          {!selected && <p className="label-property-empty">캔버스에서 요소를 선택해 주세요.</p>}
          {selected && (
            <>
              <div className="label-property-row">
                <NumberField
                  label="X(mm)"
                  value={selected.xMm}
                  min={0}
                  max={layout.widthMm}
                  onChange={(xMm) => updateSelected({ xMm })}
                />
                <NumberField
                  label="Y(mm)"
                  value={selected.yMm}
                  min={0}
                  max={layout.heightMm}
                  onChange={(yMm) => updateSelected({ yMm })}
                />
              </div>
              <div className="label-property-row">
                <NumberField
                  label="너비(mm)"
                  value={selected.widthMm}
                  min={0.5}
                  max={layout.widthMm}
                  onChange={(widthMm) => updateSelected({ widthMm })}
                />
                <NumberField
                  label="높이(mm)"
                  value={selected.heightMm}
                  min={0.5}
                  max={layout.heightMm}
                  onChange={(heightMm) => updateSelected({ heightMm })}
                />
              </div>
              {(selected.kind === "text" || selected.kind === "barcode") && (
                <label>
                  내용
                  <input
                    value={selected.content || ""}
                    onChange={(event) => updateSelected({ content: event.target.value })}
                  />
                </label>
              )}
              {selected.kind === "text" && (
                <>
                  <NumberField
                    label="글자 크기(mm)"
                    value={selected.fontSizeMm ?? 3}
                    min={1.5}
                    max={20}
                    onChange={(fontSizeMm) => updateSelected({ fontSizeMm })}
                  />
                  <label>
                    정렬
                    <select
                      value={selected.align || "left"}
                      onChange={(event) =>
                        updateSelected({ align: event.target.value as LabelTemplateElement["align"] })
                      }
                    >
                      <option value="left">왼쪽</option>
                      <option value="center">가운데</option>
                      <option value="right">오른쪽</option>
                    </select>
                  </label>
                </>
              )}
              {selected.kind === "barcode" && (
                <label className="label-check-field">
                  <input
                    type="checkbox"
                    checked={selected.showText !== false}
                    onChange={(event) => updateSelected({ showText: event.target.checked })}
                  />
                  바코드 값 표시
                </label>
              )}
              {(selected.kind === "line" || selected.kind === "box") && (
                <NumberField
                  label="선 굵기(mm)"
                  value={selected.strokeWidthMm ?? 0.4}
                  min={0.1}
                  max={5}
                  step={0.1}
                  onChange={(strokeWidthMm) => updateSelected({ strokeWidthMm })}
                />
              )}
              <button className="label-element-delete" onClick={removeSelected}>
                선택 요소 삭제
              </button>
            </>
          )}
        </aside>
      </div>

      <section className="label-template-advanced">
        <button onClick={() => void preview(false)} disabled={Boolean(busy)}>
          {busy === "preview" ? "생성 중…" : "ZPL 미리보기 생성"}
        </button>
        <button onClick={() => setAdvancedOpen((current) => !current)} disabled={!zplTemplate}>
          {advancedOpen ? "ZPL 원문 닫기" : "ZPL 원문 보기"}
        </button>
        {advancedOpen && zplTemplate && <pre>{zplTemplate}</pre>}
        <span>
          샘플:{" "}
          {Object.entries(sample)
            .map(([key, value]) => `${key}=${value}`)
            .join(" · ")}
        </span>
      </section>
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
  value: number;
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
        value={value}
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

function LabelTemplateThumbnail({ template }: { template: LabelTemplate }) {
  return (
    <div
      className="preview-paper label-template-preview-paper"
      style={{ aspectRatio: `${template.layout.widthMm} / ${template.layout.heightMm}` }}
    >
      {template.layout.elements.map((element) => (
        <span
          key={element.id}
          className={`label-template-thumbnail-element ${element.kind}`}
          style={{
            left: `${(element.xMm / template.layout.widthMm) * 100}%`,
            top: `${(element.yMm / template.layout.heightMm) * 100}%`,
            width: `${(element.widthMm / template.layout.widthMm) * 100}%`,
            height: `${(element.heightMm / template.layout.heightMm) * 100}%`,
          }}
        >
          {element.kind === "text" ? element.content?.replace(/\{\{[^{}]+\}\}/g, "데이터") : ""}
        </span>
      ))}
    </div>
  );
}

function createUniqueLabelCode(templates: readonly LabelTemplate[], now = Date.now()) {
  const used = new Set(templates.map((template) => template.code));
  const base = `LABEL_${Math.max(0, Math.trunc(now)).toString(36).toUpperCase()}`;
  if (!used.has(base)) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const code = `${base}_${index}`;
    if (!used.has(code)) return code;
  }
  throw new Error("새 라벨 양식 코드를 자동으로 만들 수 없습니다.");
}

function createUniqueLabelName(sourceName: string, templates: readonly LabelTemplate[]) {
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
