import type { FormEvent, RefObject } from "react";
import { ConfirmButtonIcon } from "../../shared/components/ActionIcons";
import { useToastAutoDismiss } from "../../shared/hooks/useToastAutoDismiss";
import type { Examinee } from "../../shared/api/examinees";
import type { AssignmentMode, PseudonymAssignment } from "../../shared/api/pseudonyms";
import { assignmentActionLabel } from "./operation-view-model";
import type { OperationNotice } from "./useOperationCandidateController";

interface Props {
  previewRef: RefObject<HTMLElement | null>;
  input: string;
  searching: boolean;
  notice: OperationNotice | null;
  candidate: Examinee | null;
  useCandidatePhotos: boolean;
  photoUrl: string | null;
  selectedMode: AssignmentMode;
  assignment: PseudonymAssignment | null;
  manualNumber: string;
  canAssign: boolean;
  assigning: boolean;
  onSearch(event: FormEvent): void;
  onInput(value: string): void;
  onReset(): void;
  onCloseNotice(): void;
  onManualNumber(value: string): void;
  onAssign(): void;
}

export function OperationControlPanel({
  previewRef,
  input,
  searching,
  notice,
  candidate,
  useCandidatePhotos,
  photoUrl,
  selectedMode,
  assignment,
  manualNumber,
  canAssign,
  assigning,
  onSearch,
  onInput,
  onReset,
  onCloseNotice,
  onManualNumber,
  onAssign,
}: Props) {
  const toastLifecycle = useToastAutoDismiss({
    enabled: Boolean(notice),
    resetKey: notice ? `${notice.kind}:${notice.text}` : "",
    onClose: onCloseNotice,
  });
  return (
    <aside className="operator-control-panel">
      <form className="operator-lookup" onSubmit={onSearch}>
        <div className="operator-lookup-field">
          <div>
            <input
              id="operator-examinee-no"
              aria-label="수험번호"
              autoFocus
              value={input}
              onChange={(event) => onInput(event.target.value.replace(/\s/g, ""))}
              placeholder="수험번호 입력 또는 스캔"
            />
            <button
              type="button"
              className="operator-input-clear"
              onClick={onReset}
              disabled={!input}
              aria-label="입력값 지우기"
            >
              ×
            </button>
          </div>
          <button
            className="operator-search-button"
            disabled={searching || !input.trim()}
            aria-label={searching ? "검색 중" : "수험자 검색"}
            title={searching ? "검색 중" : "수험자 검색"}
          >
            {searching ? <span className="operator-search-spinner" /> : <OperatorSearchIcon />}
          </button>
        </div>
        {notice && (
          <div className="operator-toast-region" aria-live={notice.kind === "error" ? "assertive" : "polite"}>
            <div
              className={`operator-toast ${notice.kind}${toastLifecycle.fading ? " is-fading" : ""}`}
              role={notice.kind === "error" ? "alert" : "status"}
              onMouseEnter={toastLifecycle.onMouseEnter}
              onMouseLeave={toastLifecycle.onMouseLeave}
            >
              <span aria-hidden="true">{notice.kind === "success" ? "✓" : "!"}</span>
              <div>
                <strong>{notice.kind === "success" ? "처리 완료" : "확인 필요"}</strong>
                <p>{notice.text}</p>
              </div>
              <button type="button" onClick={onCloseNotice} aria-label="알림 메시지 닫기">
                ×
              </button>
            </div>
          </div>
        )}
      </form>
      <section className="operator-candidate-preview" ref={previewRef}>
        <dl>
          <div>
            <dt>수험번호</dt>
            <dd>{candidate?.examineeNo || "-"}</dd>
          </div>
          <div>
            <dt>성명</dt>
            <dd>{candidate?.name || "-"}</dd>
          </div>
          <div>
            <dt>생년월일</dt>
            <dd>{candidate?.birthDate || "-"}</dd>
          </div>
          <div>
            <dt>지원전형</dt>
            <dd>{candidate?.admissionName || "-"}</dd>
          </div>
          <div>
            <dt>모집단위</dt>
            <dd>{candidate?.unitName || "-"}</dd>
          </div>
          <div>
            <dt>전공</dt>
            <dd>{candidate?.majorName || "-"}</dd>
          </div>
        </dl>
        <div className="operator-photo-row">
          <div className="operator-photo-label">사진</div>
          <div className="operator-photo-area">
            {useCandidatePhotos && photoUrl ? (
              <img src={photoUrl} alt={`${candidate?.name || "수험생"} 사진`} />
            ) : (
              <span className="empty-photo" role="img" aria-label="수험생 사진 없음">
                <OperatorPersonIcon />
              </span>
            )}
          </div>
        </div>
      </section>
      {selectedMode === "MANUAL" && !assignment && (
        <label className="operator-manual-field">
          직접 입력 가번호
          <input
            value={manualNumber}
            onChange={(event) => onManualNumber(event.target.value.replace(/\D/g, ""))}
            placeholder="숫자만 입력"
          />
        </label>
      )}
      {selectedMode !== "RANDOM" && (
        <section className="operator-primary-actions without-print">
          <button
            className="draw"
            onClick={onAssign}
            disabled={
              !canAssign ||
              assigning ||
              (selectedMode === "MANUAL" && !manualNumber) ||
              (selectedMode === "PREASSIGNED" && !candidate?.preassignedAvailable)
            }
          >
            <ConfirmButtonIcon />
            <span>
              {assigning
                ? "처리 중…"
                : assignment
                  ? `가번호 ${assignment.pseudonymNumber}`
                  : assignmentActionLabel(selectedMode)}
            </span>
          </button>
        </section>
      )}
    </aside>
  );
}

function OperatorSearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.2 4.2" />
    </svg>
  );
}

function OperatorPersonIcon() {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true">
      <circle cx="48" cy="32" r="17" />
      <path d="M18 82c1.8-20.2 13.8-31 30-31s28.2 10.8 30 31" />
    </svg>
  );
}
