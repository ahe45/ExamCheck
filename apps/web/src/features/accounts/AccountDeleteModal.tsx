import { useState } from "react";
import type { Account } from "../../shared/api/accounts";
import { CancelButtonIcon, DeleteButtonIcon } from "../../shared/components/ActionIcons";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";

interface AccountDeleteModalProps {
  account: Account;
  onClose(): void;
  onDelete(account: Account): Promise<boolean>;
}

export function AccountDeleteModal({ account, onClose, onDelete }: AccountDeleteModalProps) {
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const [deleting, setDeleting] = useState(false);

  useEscapeKey(!deleting, onClose);

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete(account);
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
      aria-labelledby="account-delete-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onClose();
      }}
    >
      <section className="account-delete-modal">
        <header>
          <span>!</span>
          <div>
            <p>ACCOUNT DELETE</p>
            <h2 id="account-delete-title">계정을 삭제하시겠습니까?</h2>
          </div>
        </header>
        <p>
          <strong>{account.loginId}</strong> 계정은 삭제 즉시 로그인과 전형 데이터 접근이 차단됩니다.
        </p>
        <footer>
          <button className="exam-ghost-button" onClick={onClose} disabled={deleting}>
            <CancelButtonIcon />
            <span>취소</span>
          </button>
          <button className="exam-danger-button" onClick={() => void remove()} disabled={deleting}>
            <DeleteButtonIcon />
            <span>{deleting ? "삭제 중…" : "계정 삭제"}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
