import { ToastNotice } from "../../shared/components/ToastNotice";
import { useRef, useState, type FormEvent } from "react";
import type { OperationSchedule } from "../../shared/api/examinees";
import { resetOperationHistory } from "../../shared/api/pseudonyms";
import { ModalCloseButton } from "../../shared/components/ModalCloseButton";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import { operationScope } from "./operation-view-model";

interface Props {
  token: string;
  examName: string;
  schedule: OperationSchedule;
  labelPrintingEnabled: boolean;
  onClose(): void;
  onReset(): Promise<void>;
}

export function OperationHistoryResetModal({
  token,
  examName,
  schedule,
  labelPrintingEnabled,
  onClose,
  onReset,
}: Props) {
  const dialogRef = useDialogFocus<HTMLElement>();
  const pending = useRef(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEscapeKey(true, () => {
    if (!pending.current) onClose();
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !password) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await resetOperationHistory(token, {
        ...operationScope(schedule, examName),
        password,
        mode: labelPrintingEnabled ? "LABEL" : "ASSIGNMENT",
      });
      setPassword("");
      await onReset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "이력을 초기화하지 못했습니다.");
      setPassword("");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="operator-modal-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="operator-finish-modal operation-history-reset-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-reset-title"
      >
        <header>
          <div>
            <p>HISTORY RESET</p>
            <h2 id="history-reset-title">이력 초기화</h2>
          </div>
          <ModalCloseButton disabled={busy} onClick={onClose} />
        </header>
        <form onSubmit={(event) => void submit(event)}>
          <div className="operator-finish-summary">
            <div>
              <span>전형명</span>
              <strong>{schedule.admissionName}</strong>
            </div>
            <div>
              <span>대상 교시</span>
              <strong>
                {schedule.date} · {schedule.time} · {schedule.periodName}
              </strong>
            </div>
            <div>
              <span>초기화 대상</span>
              <strong>{labelPrintingEnabled ? "전체 수험생의 라벨 출력이력" : "전체 수험생의 가번호 부여 이력"}</strong>
            </div>
          </div>
          <p className="operator-finish-warning">
            {labelPrintingEnabled
              ? "출력일시를 지우고 다시 출력할 수 있도록 초기화합니다."
              : "부여된 가번호를 지우고 번호 부여 순서를 초기화합니다."}{" "}
            등록 마감 상태도 해제됩니다.
          </p>
          <label className="history-reset-password-label">
            초기화 비밀번호
            <input
              data-dialog-autofocus
              type="password"
              autoComplete="off"
              required
              maxLength={200}
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="지정된 초기화 비밀번호 입력"
            />
          </label>
          {error && <ToastNotice notice={{ kind: "error", text: error }} onClose={() => setError("")} />}
          <footer>
            <button type="button" disabled={busy} onClick={onClose}>
              취소
            </button>
            <button className="primary" type="submit" disabled={busy || !password}>
              {busy ? "초기화 중…" : "이력 초기화"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
