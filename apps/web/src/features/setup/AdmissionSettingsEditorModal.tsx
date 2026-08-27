import type { RefObject } from "react";
import type { PseudonymSetting } from "../../shared/api/pseudonyms";
import { CancelButtonIcon, DiscardButtonIcon, SaveButtonIcon } from "../../shared/components/ActionIcons";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { SystemSettingsPage, type SystemSettingsPageHandle } from "./SystemSettingsPage";

interface EditorSaveState {
  canSave: boolean;
  saving: boolean;
}

interface Props {
  token: string;
  admissionName: string;
  editorRef: RefObject<SystemSettingsPageHandle | null>;
  saveState: EditorSaveState;
  closeConfirmOpen: boolean;
  savingBeforeClose: boolean;
  onDirtyChange(dirty: boolean): void;
  onSaveStateChange(state: EditorSaveState): void;
  onSaved(setting: PseudonymSetting): void;
  onRequestClose(): void;
  onCancelClose(): void;
  onDiscard(): void;
  onSave(): void;
  onSaveAndClose(): void;
}

export function AdmissionSettingsEditorModal({
  token,
  admissionName,
  editorRef,
  saveState,
  closeConfirmOpen,
  savingBeforeClose,
  onDirtyChange,
  onSaveStateChange,
  onSaved,
  onRequestClose,
  onCancelClose,
  onDiscard,
  onSave,
  onSaveAndClose,
}: Props) {
  const editorDialogRef = useDialogFocus<HTMLDivElement>();
  const closeConfirmDialogRef = useDialogFocus<HTMLDivElement>(closeConfirmOpen);

  return (
    <div
      ref={editorDialogRef}
      className="system-settings-modal-overlay admission-settings-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admission-settings-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onRequestClose();
      }}
    >
      <section className="admission-settings-modal">
        <header>
          <div>
            <p>ADMISSION SYSTEM SETTINGS</p>
            <h2 id="admission-settings-modal-title">{admissionName} 전형 설정</h2>
            <span>가번호 부여 방식과 운영 단계별 처리 정책을 설정합니다.</span>
          </div>
          <div className="admission-settings-modal-actions">
            <button type="button" className="exam-primary-button" onClick={onSave} disabled={!saveState.canSave}>
              <SaveButtonIcon />
              <span>{saveState.saving ? "저장 중…" : "설정 저장"}</span>
            </button>
            <button type="button" className="admission-settings-modal-close" onClick={onRequestClose} aria-label="닫기">
              ×
            </button>
          </div>
        </header>
        <div className="admission-settings-modal-body">
          <SystemSettingsPage
            ref={editorRef}
            token={token}
            admissionName={admissionName}
            embedded
            onDirtyChange={onDirtyChange}
            onSaveStateChange={onSaveStateChange}
            onSaved={onSaved}
          />
        </div>
      </section>
      {closeConfirmOpen && (
        <div
          ref={closeConfirmDialogRef}
          className="admission-settings-close-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="admission-settings-close-title"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <section>
            <header>
              <span>!</span>
              <div>
                <p>저장되지 않은 변경사항</p>
                <h3 id="admission-settings-close-title">{admissionName} 전형 설정을 저장하시겠습니까?</h3>
              </div>
            </header>
            <p>저장하지 않고 닫으면 변경한 설정이 사라집니다.</p>
            <footer>
              <button type="button" className="exam-ghost-button" onClick={onCancelClose} disabled={savingBeforeClose}>
                <CancelButtonIcon />
                <span>취소</span>
              </button>
              <button type="button" className="exam-outline-button" onClick={onDiscard} disabled={savingBeforeClose}>
                <DiscardButtonIcon />
                <span>저장 안 함</span>
              </button>
              <button
                type="button"
                className="exam-primary-button"
                onClick={onSaveAndClose}
                disabled={savingBeforeClose}
              >
                <SaveButtonIcon />
                <span>{savingBeforeClose ? "저장 중…" : "저장"}</span>
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
