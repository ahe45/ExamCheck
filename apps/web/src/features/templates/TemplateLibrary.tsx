import { useMemo, useState } from "react";
import {
  AddButtonIcon,
  CancelButtonIcon,
  ConfirmButtonIcon,
  CopyButtonIcon,
  DeleteButtonIcon,
  EditButtonIcon,
  RefreshButtonIcon,
} from "../../shared/components/ActionIcons";
import {
  deleteFormTemplate,
  saveFormTemplate,
  updateFormTemplateActive,
  updateFormTemplateMetadata,
  type FormTemplate,
} from "../../shared/api/form-templates";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import {
  buildCardMetadataUpdate,
  buildTemplateCopyInput,
  createCardMetadataEdit,
  groupTemplatesByCategory,
  type CardMetadataEdit,
  type TemplateMetadataField,
} from "./template-manager-model";
import { TemplateNotice, type TemplateNoticeValue } from "./TemplateNotice";
import { TemplateDeleteModal } from "./TemplateDeleteModal";

interface TemplateLibraryProps {
  token: string;
  templates: FormTemplate[];
  refreshing: boolean;
  notice: TemplateNoticeValue | null;
  onNoticeChange(notice: TemplateNoticeValue | null): void;
  onCreate(): void;
  onEdit(template: FormTemplate): void;
  onRefresh(): Promise<void>;
  onTemplateDeleted(code: string): void;
  onTemplateUpdated(template: FormTemplate): void;
}

export function TemplateLibrary({
  token,
  templates,
  refreshing,
  notice,
  onNoticeChange,
  onCreate,
  onEdit,
  onRefresh,
  onTemplateDeleted,
  onTemplateUpdated,
}: TemplateLibraryProps) {
  const [cardMetadataEdit, setCardMetadataEdit] = useState<CardMetadataEdit | null>(null);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [cardAction, setCardAction] = useState<{ templateId: number; type: "active" | "copy" | "delete" } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FormTemplate | null>(null);
  const groupedTemplates = useMemo(() => groupTemplatesByCategory(templates), [templates]);

  useEscapeKey(Boolean(cardMetadataEdit), () => setCardMetadataEdit(null));

  function beginCardMetadataEdit(template: FormTemplate, field: TemplateMetadataField) {
    onNoticeChange(null);
    setCardMetadataEdit(createCardMetadataEdit(template, field));
  }

  async function saveCardMetadata(template: FormTemplate) {
    if (!cardMetadataEdit || cardMetadataEdit.templateId !== template.id || metadataBusy) return;
    let update;
    try {
      update = buildCardMetadataUpdate(template, cardMetadataEdit);
    } catch (reason) {
      onNoticeChange({
        kind: "error",
        text: reason instanceof Error ? reason.message : "양식 정보를 확인해 주세요.",
      });
      return;
    }
    const editedField = cardMetadataEdit.field;
    setMetadataBusy(true);
    onNoticeChange(null);
    try {
      const updated = await updateFormTemplateMetadata(token, template.code, update);
      onTemplateUpdated(updated);
      setCardMetadataEdit(null);
      onNoticeChange({
        kind: "success",
        text: `${updated.name}의 ${editedField === "name" ? "제목" : "설명"}을 수정했습니다.`,
      });
    } catch (reason) {
      onNoticeChange({
        kind: "error",
        text: reason instanceof Error ? reason.message : "양식 정보를 수정하지 못했습니다.",
      });
    } finally {
      setMetadataBusy(false);
    }
  }

  async function changeTemplateActive(template: FormTemplate, active: boolean) {
    if (cardAction) return;
    setCardAction({ templateId: template.id, type: "active" });
    onNoticeChange(null);
    try {
      const updated = await updateFormTemplateActive(token, template.code, active);
      onTemplateUpdated(updated);
      onNoticeChange({
        kind: "success",
        text: `${updated.name} 양식을 ${active ? "사용" : "미사용"} 상태로 변경했습니다.`,
      });
    } catch (reason) {
      onNoticeChange({
        kind: "error",
        text: reason instanceof Error ? reason.message : "양식 사용 상태를 변경하지 못했습니다.",
      });
    } finally {
      setCardAction(null);
    }
  }

  async function copyTemplate(template: FormTemplate) {
    if (cardAction) return;
    setCardAction({ templateId: template.id, type: "copy" });
    onNoticeChange(null);
    try {
      const copied = await saveFormTemplate(token, buildTemplateCopyInput(template, templates));
      onTemplateUpdated(copied);
      onNoticeChange({ kind: "success", text: `${copied.name}을 미사용 상태로 만들었습니다.` });
    } catch (reason) {
      onNoticeChange({
        kind: "error",
        text: reason instanceof Error ? reason.message : "양식을 복사하지 못했습니다.",
      });
    } finally {
      setCardAction(null);
    }
  }

  async function removeTemplate(template: FormTemplate): Promise<boolean> {
    if (cardAction) return false;
    setCardAction({ templateId: template.id, type: "delete" });
    onNoticeChange(null);
    try {
      await deleteFormTemplate(token, template.code);
      onTemplateDeleted(template.code);
      setDeleteTarget(null);
      onNoticeChange({ kind: "success", text: `${template.name} 양식을 삭제했습니다.` });
      return true;
    } catch (reason) {
      onNoticeChange({
        kind: "error",
        text: reason instanceof Error ? reason.message : "양식을 삭제하지 못했습니다.",
      });
      return false;
    } finally {
      setCardAction(null);
    }
  }

  function renderCardMetadataField(template: FormTemplate, field: TemplateMetadataField) {
    const active = cardMetadataEdit?.templateId === template.id && cardMetadataEdit.field === field;
    const label = field === "name" ? "양식 제목" : "양식 설명";
    if (active) {
      return (
        <div className={`template-card-meta-editor template-card-meta-editor-${field}`}>
          <label className="sr-only" htmlFor={`template-${template.id}-${field}`}>
            {label} 수정
          </label>
          <input
            autoFocus
            className="template-card-meta-input"
            disabled={metadataBusy}
            id={`template-${template.id}-${field}`}
            maxLength={field === "name" ? 200 : 500}
            placeholder={`${label}을 입력하세요.`}
            value={cardMetadataEdit.value}
            onChange={(event) =>
              setCardMetadataEdit((current) => (current ? { ...current, value: event.target.value } : current))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void saveCardMetadata(template);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setCardMetadataEdit(null);
              }
            }}
          />
          <div className="template-card-meta-editor-actions">
            <button
              className="template-card-meta-action-button save"
              disabled={metadataBusy}
              onClick={() => void saveCardMetadata(template)}
              aria-label={`${label} 저장`}
              title="저장"
            >
              <ConfirmButtonIcon />
            </button>
            <button
              className="template-card-meta-action-button cancel"
              disabled={metadataBusy}
              onClick={() => setCardMetadataEdit(null)}
              aria-label={`${label} 수정 취소`}
              title="취소"
            >
              <CancelButtonIcon />
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className={`template-card-meta-row template-card-meta-row-${field}`}>
        {field === "name" ? <h3>{template.name}</h3> : <p>{template.description || "설명 없음"}</p>}
        <button
          className="template-card-meta-edit-button"
          onClick={() => beginCardMetadataEdit(template, field)}
          aria-label={`${label} 수정`}
          title={`${label} 수정`}
        >
          <EditButtonIcon />
        </button>
      </div>
    );
  }

  return (
    <>
      <section className="examlist-template-library">
        <header className="admin-view-heading">
          <div>
            <h2>양식 관리</h2>
            <p>가번호표와 라벨 출력 양식을 만들고 수정합니다.</p>
          </div>
          <div className="admin-view-actions">
            <span className="count-badge">총 {templates.length}건</span>
            <button className="exam-outline-button" onClick={() => void onRefresh()} disabled={refreshing}>
              <RefreshButtonIcon />
              <span>{refreshing ? "불러오는 중…" : "새로고침"}</span>
            </button>
            <button className="exam-primary-button" onClick={onCreate}>
              <AddButtonIcon />
              <span>새 양식</span>
            </button>
          </div>
        </header>
        {notice && <TemplateNotice notice={notice} onClose={() => onNoticeChange(null)} />}
        <div className="exam-template-card-grid">
          {Object.values(groupedTemplates).flatMap((items) =>
            items.map((template) => (
              <article className="exam-template-card" key={template.id}>
                <div className="exam-template-card-copy">
                  <div className="template-card-title-row">{renderCardMetadataField(template, "name")}</div>
                  {renderCardMetadataField(template, "description")}
                </div>
                <div className="exam-template-preview" aria-hidden="true">
                  <div className="preview-paper">
                    <strong>{template.name}</strong>
                    <span />
                    <span />
                    <span />
                    <div>
                      <i />
                      <i />
                    </div>
                  </div>
                </div>
                <footer>
                  <label className={`template-card-status-switch ${template.active ? "active" : ""}`}>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={template.active}
                      disabled={Boolean(cardAction)}
                      aria-label={`${template.name} 사용 여부`}
                      onChange={(event) => void changeTemplateActive(template, event.target.checked)}
                    />
                    <i aria-hidden="true" />
                    <span>{template.active ? "사용" : "미사용"}</span>
                  </label>
                  <div className="template-card-actions">
                    <button
                      className="exam-outline-button compact template-card-delete-button"
                      disabled={Boolean(cardAction)}
                      onClick={() => {
                        onNoticeChange(null);
                        setDeleteTarget(template);
                      }}
                    >
                      <DeleteButtonIcon />
                      <span>삭제</span>
                    </button>
                    <button
                      className="exam-outline-button compact"
                      disabled={Boolean(cardAction)}
                      onClick={() => void copyTemplate(template)}
                    >
                      <CopyButtonIcon />
                      <span>
                        {cardAction?.templateId === template.id && cardAction.type === "copy" ? "복사 중…" : "복사"}
                      </span>
                    </button>
                    <button
                      className="exam-primary-button compact"
                      disabled={Boolean(cardAction)}
                      onClick={() => onEdit(template)}
                    >
                      <EditButtonIcon />
                      <span>수정</span>
                    </button>
                  </div>
                </footer>
              </article>
            )),
          )}
          {templates.length === 0 && (
            <div className="admin-view-empty">
              <p>등록된 양식이 없습니다.</p>
              <button className="exam-primary-button" onClick={onCreate}>
                <AddButtonIcon />
                <span>첫 양식 만들기</span>
              </button>
            </div>
          )}
        </div>
      </section>
      {deleteTarget && (
        <TemplateDeleteModal template={deleteTarget} onClose={() => setDeleteTarget(null)} onDelete={removeTemplate} />
      )}
    </>
  );
}
