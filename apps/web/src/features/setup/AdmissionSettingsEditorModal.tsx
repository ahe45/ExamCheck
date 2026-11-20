import { ModalCloseButton } from "../../shared/components/ModalCloseButton";
import type { RefObject } from "react";
import type { PseudonymSetting } from "../../shared/api/pseudonyms";
import { CancelButtonIcon, DiscardButtonIcon, SaveButtonIcon } from "../../shared/components/ActionIcons";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { SystemSettingsPage, type SettingsScope, type SystemSettingsPageHandle } from "./SystemSettingsPage";

interface EditorSaveState {
  canSave: boolean;
  saving: boolean;
}

interface Props {
  token: string;
  admissionName: string;
  scopeLabel?: string;
  batchScopes?: readonly SettingsScope[];
  editorRef: RefObject<SystemSettingsPageHandle | null>;
  saveState: EditorSaveState;
  closeConfirmOpen: boolean;
  savingBeforeClose: boolean;
  onDirtyChange(dirty: boolean): void;
  onSaveStateChange(state: EditorSaveState): void;
  onSaved(settings: PseudonymSetting[]): void;
  onRequestClose(): void;
  onCancelClose(): void;
  onDiscard(): void;
  onSave(): void;
  onSaveAndClose(): void;
}

export function AdmissionSettingsEditorModal({
  token,
  admissionName,
  scopeLabel,
  batchScopes,
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
  const title = batchScopes ? "전체 항목 일괄 설정" : scopeLabel ? `${scopeLabel} 설정` : `${admissionName} 전형 설정`;
  const saveLabel = saveState.saving ? "저장 중…" : batchScopes ? "전체 항목에 저장" : "설정 저장";

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
            {!batchScopes && <p>ADMISSION SYSTEM SETTINGS</p>}
            <h2 id="admission-settings-modal-title">{title}</h2>
            <span>
              {batchScopes
                ? `${scopeLabel}의 부여 방식과 운영 정책으로 시작합니다. 저장하면 편집한 공통 설정을 ${batchScopes.length}개 항목에 적용합니다.`
                : "가번호 부여 방식과 운영 단계별 처리 정책을 설정합니다."}
            </span>
          </div>
          <div className="admission-settings-modal-actions">
            <button
              type="button"
              className="exam-outline-button"
              onClick={onSave}
              disabled={!saveState.canSave}
              aria-label={saveLabel}
            >
              <SaveButtonIcon />
              <span>{saveLabel}</span>
            </button>
            <ModalCloseButton onClick={onRequestClose} disabled={saveState.saving || savingBeforeClose} />
          </div>
        </header>
        <div className="admission-settings-modal-body">
          <SystemSettingsPage
            ref={editorRef}
            token={token}
            admissionName={admissionName}
            scopeLabel={scopeLabel}
            batchScopes={batchScopes}
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
                <h3 id="admission-settings-close-title">{title}을 저장하시겠습니까?</h3>
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
