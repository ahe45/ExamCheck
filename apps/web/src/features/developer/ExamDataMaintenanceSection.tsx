import { useRef, useState, type FormEvent } from "react";
import { maintainExamData } from "../../shared/api/developer-settings";
import { ModalCloseButton } from "../../shared/components/ModalCloseButton";
import { ToastNotice } from "../../shared/components/ToastNotice";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";

const actions = {
  reset: {
    title: "전체 초기화",
    description:
      "전체 시험의 가번호 배정, 라벨 출력 상태와 마감을 초기화합니다. 수험생과 가번호 범위 설정은 보존됩니다.",
    buttonClass: "exam-outline-button",
    success: "전체 시험 운영 이력을 초기화했습니다.",
  },
  delete: {
    title: "전체 삭제",
    description:
      "모든 수험생과 사진, 가번호 배정, 출력·운영·감사 이력, 시험 설정과 분류별 접근 배정을 삭제합니다. 계정, 공용 양식, 시스템 기본 정보는 보존됩니다.",
    buttonClass: "exam-danger-button",
    success: "등록된 시험 데이터를 모두 삭제했습니다.",
  },
} as const;

type Action = keyof typeof actions;

export function ExamDataMaintenanceSection({ token }: { token: string }) {
  const [action, setAction] = useState<Action | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  return (
    <section
      className="developer-settings-card history-reset-password-card exam-data-maintenance-card"
      aria-labelledby="exam-data-maintenance-title"
    >
      <h3 id="exam-data-maintenance-title">초기화 및 삭제</h3>
      {(["reset", "delete"] as const).map((key) => (
        <div className="exam-data-maintenance-row" key={key}>
          <p>{actions[key].description}</p>
          <button
            type="button"
            className={actions[key].buttonClass}
            onClick={() => {
              setSuccess(null);
              setAction(key);
            }}
          >
            {actions[key].title}
          </button>
        </div>
      ))}
      {success && <ToastNotice notice={{ kind: "success", text: success }} onClose={() => setSuccess(null)} />}
      {action && (
        <ExamDataMaintenanceDialog
          token={token}
          action={action}
          onClose={() => setAction(null)}
          onSuccess={() => {
            setSuccess(actions[action].success);
            setAction(null);
          }}
        />
      )}
    </section>
  );
}

function ExamDataMaintenanceDialog({
  token,
  action,
  onClose,
  onSuccess,
}: {
  token: string;
  action: Action;
  onClose(): void;
  onSuccess(): void;
}) {
  const { title, description } = actions[action];
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const dialogRef = useDialogFocus<HTMLFormElement>();
  useEscapeKey(!busy, onClose);
  const ready = password.length >= 4 && confirmation === title;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await maintainExamData(token, { action, password, confirmation });
      onSuccess();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "작업을 완료하지 못했습니다.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="system-settings-modal-overlay" role="presentation">
      <form
        ref={dialogRef}
        className="developer-password-modal exam-data-maintenance-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exam-data-confirm-title"
        aria-describedby="exam-data-confirm-description"
        onSubmit={(event) => void submit(event)}
      >
        <header>
          <div>
            <h2 id="exam-data-confirm-title">{title} 확인</h2>
            <small id="exam-data-confirm-description">{description} 이 작업은 되돌릴 수 없습니다.</small>
          </div>
          <ModalCloseButton onClick={onClose} disabled={busy} />
        </header>
        {error && <ToastNotice notice={{ kind: "error", text: error }} onClose={() => setError(null)} />}
        <div className="developer-password-fields">
          <label>
            <span>초기화 비밀번호</span>
            <input
              type="password"
              autoComplete="current-password"
              data-dialog-autofocus
              required
              minLength={4}
              maxLength={200}
              disabled={busy}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            <span>확인 문구 ‘{title}’ 입력</span>
            <input
              autoComplete="off"
              required
              disabled={busy}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
        </div>
        <footer>
          <div>
            <button type="button" className="exam-ghost-button" onClick={onClose} disabled={busy}>
              취소
            </button>
            <button
              type="submit"
              className={action === "delete" ? "exam-danger-button" : "exam-primary-button"}
              disabled={!ready || busy}
            >
              {busy ? "처리 중…" : title}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
