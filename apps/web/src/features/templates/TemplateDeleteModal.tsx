import { useState } from "react";
import type { FormTemplate } from "../../shared/api/form-templates";
import { CancelButtonIcon, DeleteButtonIcon } from "../../shared/components/ActionIcons";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";

interface TemplateDeleteModalProps {
  template: FormTemplate;
  onClose(): void;
  onDelete(template: FormTemplate): Promise<boolean>;
}

export function TemplateDeleteModal({ template, onClose, onDelete }: TemplateDeleteModalProps) {
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const [deleting, setDeleting] = useState(false);

  useEscapeKey(!deleting, onClose);

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete(template);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      className="system-settings-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-delete-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onClose();
      }}
    >
      <section className="template-delete-modal">
        <header>
          <span>!</span>
          <div>
            <p>TEMPLATE DELETE</p>
            <h2 id="template-delete-title">양식을 삭제하시겠습니까?</h2>
          </div>
        </header>
        <p>
          <strong>{template.name}</strong> 양식은 삭제 후 양식 관리 및 사용자 출력 목록에서 표시되지 않습니다.
        </p>
        <footer>
          <button className="exam-ghost-button" onClick={onClose} disabled={deleting}>
            <CancelButtonIcon />
            <span>취소</span>
          </button>
          <button className="exam-danger-button" onClick={() => void remove()} disabled={deleting}>
            <DeleteButtonIcon />
            <span>{deleting ? "삭제 중…" : "양식 삭제"}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
