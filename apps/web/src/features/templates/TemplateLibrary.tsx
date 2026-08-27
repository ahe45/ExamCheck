import { useMemo, useState } from "react";
import {
  AddButtonIcon,
  CancelButtonIcon,
  ConfirmButtonIcon,
  EditButtonIcon,
  RefreshButtonIcon,
} from "../../shared/components/ActionIcons";
import { updateFormTemplateMetadata, type FormTemplate } from "../../shared/api/form-templates";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import {
  buildCardMetadataUpdate,
  createCardMetadataEdit,
  groupTemplatesByCategory,
  scopeLabel,
  type CardMetadataEdit,
  type TemplateMetadataField,
} from "./template-manager-model";
import { TemplateNotice, type TemplateNoticeValue } from "./TemplateNotice";

interface TemplateLibraryProps {
  token: string;
  templates: FormTemplate[];
  refreshing: boolean;
  notice: TemplateNoticeValue | null;
  onNoticeChange(notice: TemplateNoticeValue | null): void;
  onCreate(): void;
  onEdit(template: FormTemplate): void;
  onRefresh(): Promise<void>;
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
  onTemplateUpdated,
}: TemplateLibraryProps) {
  const [cardMetadataEdit, setCardMetadataEdit] = useState<CardMetadataEdit | null>(null);
  const [metadataBusy, setMetadataBusy] = useState(false);
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
        {Object.entries(groupedTemplates).flatMap(([category, items]) =>
          items.map((template) => (
            <article className="exam-template-card" key={template.id}>
              <div className="exam-template-card-copy">
                <div className="template-card-title-row">
                  {renderCardMetadataField(template, "name")}
                  <span>{category}</span>
                </div>
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
                <span>
                  v{template.version} · {scopeLabel(template.usageScope)} · {template.active ? "사용 중" : "사용 중지"}
                </span>
                <button className="exam-primary-button compact" onClick={() => onEdit(template)}>
                  <EditButtonIcon />
                  <span>수정</span>
                </button>
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
  );
}
