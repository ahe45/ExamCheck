import { ModalCloseButton } from "../../shared/components/ModalCloseButton";
import { useState } from "react";
import {
  CancelButtonIcon,
  ConfirmButtonIcon,
  ResetButtonIcon,
  SaveButtonIcon,
} from "../../shared/components/ActionIcons";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import type { DataTagCatalog } from "../../shared/templates/template-editor-contracts";
import { groupDataTags } from "./enhance-data-tag-panel";
import { renderProjectDataTagIcon } from "./editor/examlist-template-editor-adapter";
import type { DraftTemplate } from "./template-manager-model";

interface TemplateInformationModalProps {
  draft: DraftTemplate;
  onChange<K extends keyof DraftTemplate>(key: K, value: DraftTemplate[K]): void;
  onClose(): void;
}

export function TemplateInformationModal({ draft, onChange, onClose }: TemplateInformationModalProps) {
  const dialogRef = useDialogFocus<HTMLElement>();
  useEscapeKey(true, onClose);
  return (
    <div
      className="admin-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="admin-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-information-title"
      >
        <header>
          <div>
            <p>양식 설정</p>
            <h2 id="template-information-title">양식 정보</h2>
          </div>
          <ModalCloseButton onClick={onClose} />
        </header>
        <div className="template-information-fields">
          <label className="wide-field">
            양식명
            <input
              maxLength={200}
              placeholder="양식명을 입력하세요."
              value={draft.name}
              onChange={(event) => onChange("name", event.target.value)}
            />
          </label>
          <label className="wide-field">
            설명
            <input
              maxLength={500}
              placeholder="양식 설명을 입력하세요."
              value={draft.description}
              onChange={(event) => onChange("description", event.target.value)}
            />
          </label>
        </div>
        <footer>
          <button className="exam-ghost-button" onClick={onClose}>
            <ConfirmButtonIcon />
            <span>확인</span>
          </button>
        </footer>
      </section>
    </div>
  );
}

interface DataTagSettingsModalProps {
  catalog: DataTagCatalog;
  onClose(): void;
  onSave(examples: Record<string, string>): void;
}

export function DataTagSettingsModal({ catalog, onClose, onSave }: DataTagSettingsModalProps) {
  const dialogRef = useDialogFocus<HTMLElement>();
  useEscapeKey(true, onClose);
  const definitions = [
    ...(Array.isArray(catalog.tags) ? catalog.tags : []),
    ...(Array.isArray(catalog.groups)
      ? catalog.groups.flatMap((group) => (Array.isArray(group.tags) ? group.tags : []))
      : []),
  ];
  const groups = groupDataTags(catalog);
  const initialExamples = Object.fromEntries(
    definitions.map((tag) => [String(tag.key || ""), String(tag.example || "")]),
  );
  const [examples, setExamples] = useState<Record<string, string>>(initialExamples);
  return (
    <div
      className="tag-settings-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="tag-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-tag-settings-title"
      >
        <header>
          <h2 id="data-tag-settings-title">데이터 태그 설정</h2>
          <ModalCloseButton onClick={onClose} />
        </header>
        <div className="tag-settings-groups">
          {groups.map((group) => (
            <details className="tag-settings-group" key={String(group.id || group.label)}>
              <summary>
                <span
                  className="tag-settings-group-icon"
                  dangerouslySetInnerHTML={{ __html: renderProjectDataTagIcon(group.icon) }}
                />
                <span>{String(group.label || "기타")}</span>
                <b>{group.tags?.length || 0}</b>
                <i aria-hidden="true" />
              </summary>
              <div>
                {group.tags?.map((tag) => {
                  const key = String(tag.key || "");
                  return (
                    <label key={key}>
                      <span>
                        <strong>{String(tag.label || key)}</strong>
                        <small>{key}</small>
                      </span>
                      <input
                        value={examples[key] ?? ""}
                        onChange={(event) =>
                          setExamples((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                        aria-label={`${String(tag.label || key)} 샘플값`}
                      />
                    </label>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
        <footer>
          <button className="exam-ghost-button" onClick={() => setExamples(initialExamples)}>
            <ResetButtonIcon />
            <span>기본값 복원</span>
          </button>
          <span />
          <button className="exam-ghost-button" onClick={onClose}>
            <CancelButtonIcon />
            <span>취소</span>
          </button>
          <button className="exam-primary-button" onClick={() => onSave(examples)}>
            <SaveButtonIcon />
            <span>저장</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
