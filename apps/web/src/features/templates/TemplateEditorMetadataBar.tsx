import type { ReactNode } from "react";

export function TemplateEditorMetadataBar({
  name,
  description,
  onNameChange,
  onDescriptionChange,
  children,
}: {
  name: string;
  description: string;
  onNameChange(value: string): void;
  onDescriptionChange(value: string): void;
  children: ReactNode;
}) {
  return (
    <div className="template-editor-context-bar">
      <div className="template-editor-context-fields">
        <label className="template-editor-context-field">
          <span>제목</span>
          <input
            className="template-editor-title-input"
            aria-label="양식 제목"
            maxLength={200}
            placeholder="양식 제목을 입력하세요."
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </label>
        <label className="template-editor-context-field">
          <span>설명</span>
          <input
            className="template-editor-description-input"
            aria-label="양식 설명"
            maxLength={500}
            placeholder="양식 설명을 입력하세요."
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
          />
        </label>
        <div className="template-editor-context-actions">{children}</div>
      </div>
    </div>
  );
}
