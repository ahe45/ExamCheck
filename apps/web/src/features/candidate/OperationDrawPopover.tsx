import type { CSSProperties } from "react";
import { ConfirmButtonIcon } from "../../shared/components/ActionIcons";
import type { PseudonymAssignment } from "../../shared/api/pseudonyms";
import { drawViewModel } from "./operation-view-model";

interface Props {
  position: { left: number; top: number };
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
  const view = drawViewModel({
    assignment,
    previewNumber,
    autoDrawEnabled,
    remainingMs,
    delaySeconds,
    canAssign,
    assigning,
  });

  return (
    <section className={view.className} style={position} role="dialog" aria-label="가번호 추첨">
      <header>
        <div>
          <span>RANDOM DRAW</span>
          <strong>{view.title}</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="추첨 화면 닫기">
          ×
        </button>
      </header>
      <div className="operator-draw-number">
        <span>{view.displayNumber}</span>
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
        <button type="button" className="operator-draw-confirm" onClick={onClose}>
          <ConfirmButtonIcon />
          <span>확인</span>
        </button>
      ) : (
        <button type="button" className="operator-draw-action" onClick={onAssign} disabled={view.actionDisabled}>
          <ConfirmButtonIcon />
          <span>{view.actionLabel}</span>
        </button>
      )}
    </section>
  );
}
