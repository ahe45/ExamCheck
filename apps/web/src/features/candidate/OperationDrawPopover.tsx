import { ModalCloseButton } from "../../shared/components/ModalCloseButton";
import { useEffect, useRef, type CSSProperties } from "react";
import { ConfirmButtonIcon } from "../../shared/components/ActionIcons";
import type { PseudonymAssignment } from "../../shared/api/pseudonyms";
import { drawViewModel } from "./operation-view-model";

interface Props {
  position: { left: number; top: number };
  sequential?: boolean;
  matching?: boolean;
  manualNumber?: string;
  onManualNumber?(value: string): void;
  sequentialPreviewNumber?: string | null;
  previewLoading?: boolean;
  assignment: PseudonymAssignment | null;
  previewNumber: number;
  autoDrawEnabled: boolean;
  remainingMs: number;
  delaySeconds: number;
  canAssign: boolean;
  assigning: boolean;
  onClose(): void;
  onAssign(): void;
}

export function OperationDrawPopover({
  position,
  sequential = false,
  matching = false,
  manualNumber = "",
  onManualNumber,
  sequentialPreviewNumber = null,
  previewLoading = false,
  assignment,
  previewNumber,
  autoDrawEnabled,
  remainingMs,
  delaySeconds,
  canAssign,
  assigning,
  onClose,
  onAssign,
}: Props) {
  const numberInputRef = useRef<HTMLInputElement>(null);
  const drawButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.key !== "Enter" && event.key !== "F9")) return;
      if (event.key === "Enter") {
        if (event.target === confirmButtonRef.current && event.repeat) {
          event.preventDefault();
          return;
        }
        // Search-field Enter must only search; action Enter belongs to the popover controls.
        if (event.target !== numberInputRef.current && event.target !== drawButtonRef.current) return;
        event.preventDefault();
      }
      if (event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
      const button = event.key === "Enter" ? drawButtonRef.current : confirmButtonRef.current;
      if (!button || button.disabled || button.closest("[inert]")) return;
      event.preventDefault();
      button.click();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  const view = drawViewModel({
    assignment,
    previewNumber,
    autoDrawEnabled: !sequential && !matching && autoDrawEnabled,
    remainingMs,
    delaySeconds,
    canAssign,
    assigning,
  });

  if (sequential || matching) {
    view.title = view.complete ? "저장 완료" : matching ? "가번호 매칭" : "가번호 순차부여";
    view.displayNumber = assignment?.pseudonymNumber ?? sequentialPreviewNumber ?? (previewLoading ? "조회 중…" : "—");
    view.actionLabel = assigning ? "저장 중…" : "저장";
    view.actionDisabled =
      view.actionDisabled || !manualNumber.trim() || (sequential && sequentialPreviewNumber === null) || previewLoading;
    view.className = `operator-draw-popover ${view.complete ? "complete" : "sequential"}`;
  }

  return (
    <section
      className={view.className}
      style={position}
      role="dialog"
      aria-label={matching ? "가번호 매칭" : sequential ? "가번호 순차부여" : "가번호 추첨"}
    >
      <header>
        <div>
          <span>{matching ? "NUMBER MATCHING" : sequential ? "SEQUENTIAL ASSIGNMENT" : "RANDOM DRAW"}</span>
          <strong>{view.title}</strong>
        </div>
        <ModalCloseButton
          onClick={onClose}
          aria-label={matching ? "매칭 화면 닫기" : sequential ? "순차부여 화면 닫기" : "추첨 화면 닫기"}
        />
      </header>
      <div className="operator-draw-number">
        {sequential || matching ? (
          <input
            ref={numberInputRef}
            className="operator-assignment-number-input"
            aria-label="가번호"
            inputMode="numeric"
            autoComplete="off"
            maxLength={9}
            autoFocus
            readOnly={previewLoading || assigning || Boolean(assignment)}
            value={assignment?.pseudonymNumber ?? manualNumber}
            placeholder={matching ? "가번호 입력" : previewLoading ? "조회 중…" : "—"}
            onChange={(event) => onManualNumber?.(event.target.value.replace(/\D/g, ""))}
          />
        ) : (
          <span>{view.displayNumber}</span>
        )}
      </div>
      {view.showCountdown && (
        <div
          className="operator-draw-countdown"
          style={{ "--countdown-progress": `${view.countdownProgress}%` } as CSSProperties}
        >
          <div className="operator-draw-countdown-heading">
            <span>자동 추첨까지 남은 시간</span>
            <strong>
              {view.remainingSecondsText}
              <small>초</small>
            </strong>
          </div>
          <div
            className="operator-draw-progress-track"
            role="progressbar"
            aria-label="자동 추첨 남은 시간"
            aria-valuemin={0}
            aria-valuemax={delaySeconds * 1000}
            aria-valuenow={remainingMs}
          >
            <span />
          </div>
          <p>지정 시간이 지나면 자동으로 가번호를 추첨합니다.</p>
        </div>
      )}
      {view.complete ? (
        <button
          ref={confirmButtonRef}
          type="button"
          className="operator-draw-confirm"
          onClick={onClose}
          aria-keyshortcuts="F9"
          title="확인 (F9)"
        >
          <ConfirmButtonIcon />
          <span>확인</span>
          <kbd className="operator-draw-shortcut" aria-hidden="true">
            F9
          </kbd>
        </button>
      ) : (
        <button
          ref={drawButtonRef}
          autoFocus={!sequential && !matching}
          type="button"
          className="operator-draw-action"
          onClick={onAssign}
          disabled={view.actionDisabled}
          aria-keyshortcuts="Enter"
          title={`${view.actionLabel} (Enter)`}
        >
          <ConfirmButtonIcon />
          <span>{view.actionLabel}</span>
          <kbd className="operator-draw-shortcut" aria-hidden="true">
            Enter
          </kbd>
        </button>
      )}
    </section>
  );
}
