import { ToastNotice } from "../../shared/components/ToastNotice";
import { ModalCloseButton } from "../../shared/components/ModalCloseButton";
import type { FormEvent } from "react";
import { CancelButtonIcon, KeyButtonIcon } from "../../shared/components/ActionIcons";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import type { DeveloperPasswordForm, DeveloperSettingsNotice } from "./developer-settings-model";
import { DeveloperLockIcon } from "./DeveloperSettingsIcons";

interface Props {
  loginId: string;
  password: DeveloperPasswordForm;
  saving: boolean;
  notice: DeveloperSettingsNotice | null;
  onPasswordChange(patch: Partial<DeveloperPasswordForm>): void;
  onClose(): void;
  onSave(): void;
  onCloseNotice?(): void;
}

export function DeveloperPasswordModal({
  loginId,
  password,
  saving,
  notice,
  onPasswordChange,
  onClose,
  onSave,
  onCloseNotice,
}: Props) {
  const dialogRef = useDialogFocus<HTMLFormElement>();
  useEscapeKey(!saving, onClose);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave();
  }

  return (
    <div
      className="system-settings-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        ref={dialogRef}
        className="developer-password-modal"
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="developer-password-title"
      >
        <header>
          <span className="developer-section-icon">
            <DeveloperLockIcon />
          </span>
          <div>
            <p>DEVELOPER ACCOUNT</p>
            <h2 id="developer-password-title">개발자 비밀번호 변경</h2>
            <small>현재 비밀번호를 확인한 뒤 새 비밀번호로 변경합니다.</small>
          </div>
          <ModalCloseButton onClick={onClose} disabled={saving} />
        </header>
        {notice && <ToastNotice notice={notice} onClose={onCloseNotice} />}
        <div className="developer-password-fields">
          <label>
            <span>현재 비밀번호</span>
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password.current}
              onChange={(event) => onPasswordChange({ current: event.target.value })}
              placeholder="현재 비밀번호 입력"
            />
          </label>
          <label>
            <span>새 비밀번호</span>
            <input
              required
              type="password"
              minLength={4}
              autoComplete="new-password"
              value={password.next}
              onChange={(event) => onPasswordChange({ next: event.target.value })}
              placeholder="4자 이상 입력"
            />
          </label>
          <label>
            <span>새 비밀번호 확인</span>
            <input
              required
              type="password"
              autoComplete="new-password"
              value={password.confirm}
              onChange={(event) => onPasswordChange({ confirm: event.target.value })}
              placeholder="새 비밀번호 다시 입력"
            />
          </label>
        </div>
        <footer>
          <span>
            개발자 계정 ID <strong>{loginId}</strong>
          </span>
          <div>
            <button type="button" className="exam-ghost-button" onClick={onClose} disabled={saving}>
              <CancelButtonIcon />
              <span>취소</span>
            </button>
            <button className="exam-primary-button" disabled={saving}>
              <KeyButtonIcon />
              <span>{saving ? "변경 중…" : "비밀번호 변경"}</span>
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
