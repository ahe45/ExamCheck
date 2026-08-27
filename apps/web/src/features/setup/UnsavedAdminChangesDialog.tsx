import { CancelButtonIcon, DiscardButtonIcon, SaveButtonIcon } from "../../shared/components/ActionIcons";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";

interface Props {
  open: boolean;
  saving: boolean;
  dirtyLabel: string;
  onCancel(): void;
  onDiscard(): void;
  onSave(): void;
}

export function UnsavedAdminChangesDialog({ open, saving, dirtyLabel, onCancel, onDiscard, onSave }: Props) {
  const dialogRef = useDialogFocus<HTMLDivElement>(open);
  if (!open) return null;
  return (
    <div
      ref={dialogRef}
      className="system-settings-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-settings-title"
    >
      <section className="unsaved-settings-modal">
        <header>
          <div>
            <p>저장되지 않은 변경사항</p>
            <h2 id="unsaved-settings-title">{dirtyLabel}을 저장하시겠습니까?</h2>
          </div>
          <button type="button" onClick={onCancel} disabled={saving} aria-label="닫기">
            ×
          </button>
        </header>
        <div className="unsaved-settings-copy">
          <span>!</span>
          <p>
            변경한 {dirtyLabel}이 아직 저장되지 않았습니다.
            <small>저장하지 않고 이동하면 변경한 내용이 사라집니다.</small>
          </p>
        </div>
        <footer>
          <button type="button" className="exam-ghost-button" onClick={onCancel} disabled={saving}>
            <CancelButtonIcon />
            <span>취소</span>
          </button>
          <button type="button" className="exam-outline-button" onClick={onDiscard} disabled={saving}>
            <DiscardButtonIcon />
            <span>저장 안 함</span>
          </button>
          <button type="button" className="exam-primary-button" onClick={onSave} disabled={saving}>
            <SaveButtonIcon />
            <span>{saving ? "저장 중…" : "저장"}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
