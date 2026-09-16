import { ModalCloseButton } from "../../shared/components/ModalCloseButton";
import { useState, type FormEvent } from "react";
import type { Account, AccountInput, AccountRole } from "../../shared/api/accounts";
import { CancelButtonIcon, SaveButtonIcon } from "../../shared/components/ActionIcons";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import {
  accountFormError,
  accountFormFor,
  accountInputFrom,
  withAccountRole,
  withToggledAdmission,
} from "./account-management-model";

interface AccountEditorModalProps {
  admissions: string[];
  editing: Account | null;
  onClose(): void;
  onSave(account: Account | null, input: AccountInput): Promise<boolean>;
  onValidationError(message: string): void;
}

export function AccountEditorModal({
  admissions,
  editing,
  onClose,
  onSave,
  onValidationError,
}: AccountEditorModalProps) {
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const [form, setForm] = useState(() => accountFormFor(editing));
  const [saving, setSaving] = useState(false);

  useEscapeKey(!saving, onClose);

  function changeRole(role: AccountRole) {
    setForm((current) => withAccountRole(current, role));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const validationError = accountFormError(form, Boolean(editing));
    if (validationError) {
      onValidationError(validationError);
      return;
    }
    setSaving(true);
    try {
      await onSave(editing, accountInputFrom(form));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      className="system-settings-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-editor-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form className="account-editor-modal" onSubmit={(event) => void save(event)}>
        <header>
          <div>
            <p>{editing ? "ACCOUNT EDIT" : "NEW ACCOUNT"}</p>
            <h2 id="account-editor-title">{editing ? "계정 수정" : "계정 생성"}</h2>
          </div>
          <ModalCloseButton onClick={onClose} disabled={saving} />
        </header>
        <div className="account-editor-body">
          <div className="account-form-grid">
            <label>
              <span>아이디</span>
              <input
                required
                maxLength={100}
                value={form.loginId}
                onChange={(event) => setForm({ ...form, loginId: event.target.value })}
                placeholder="로그인 아이디"
              />
            </label>
            <label>
              <span>{editing ? "새 비밀번호" : "비밀번호"}</span>
              <input
                type="password"
                required={!editing}
                minLength={editing ? undefined : 4}
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                placeholder={editing ? "변경할 때만 입력" : "4자 이상"}
              />
            </label>
            <label>
              <span>비밀번호 확인</span>
              <input
                type="password"
                required={Boolean(form.password)}
                value={form.passwordConfirm}
                onChange={(event) => setForm({ ...form, passwordConfirm: event.target.value })}
                placeholder="비밀번호 다시 입력"
              />
            </label>
          </div>
          <section className="account-role-section">
            <header>
              <strong>계정 권한</strong>
              <small>관리자는 전체 설정을, 사용자는 지정된 접근 범위의 운영 화면을 사용합니다.</small>
            </header>
            <div>
              <button
                type="button"
                className={form.role === "ADMIN" ? "active" : ""}
                onClick={() => changeRole("ADMIN")}
              >
                <strong>관리자</strong>
                <small>모든 관리 기능과 전체 전형 접근</small>
              </button>
              <button type="button" className={form.role === "USER" ? "active" : ""} onClick={() => changeRole("USER")}>
                <strong>사용자</strong>
                <small>전형 지정 또는 전체 전형 운영</small>
              </button>
            </div>
          </section>
          {form.role === "USER" && (
            <section className="account-admission-section">
              <header>
                <div>
                  <strong>전형 배정</strong>
                  <small>선택한 전형만 조회되며, 아무것도 선택하지 않으면 전체 전형·교시에 접근합니다.</small>
                </div>
                <span>{form.admissionNames.length ? `${form.admissionNames.length}개 선택` : "전체 접근"}</span>
              </header>
              {admissions.length ? (
                <div>
                  {admissions.map((admission) => (
                    <label className={form.admissionNames.includes(admission) ? "selected" : ""} key={admission}>
                      <input
                        type="checkbox"
                        checked={form.admissionNames.includes(admission)}
                        onChange={() => setForm((current) => withToggledAdmission(current, admission))}
                      />
                      <span>{admission}</span>
                      <i>✓</i>
                    </label>
                  ))}
                </div>
              ) : (
                <p>등록된 수험생 전형이 없습니다. 수험생 데이터를 먼저 업로드해 주세요.</p>
              )}
            </section>
          )}
        </div>
        <footer>
          <button type="button" className="exam-ghost-button" onClick={onClose} disabled={saving}>
            <CancelButtonIcon />
            <span>취소</span>
          </button>
          <button className="exam-primary-button" disabled={saving}>
            <SaveButtonIcon />
            <span>{saving ? "저장 중…" : editing ? "변경사항 저장" : "계정 생성"}</span>
          </button>
        </footer>
      </form>
    </div>
  );
}
