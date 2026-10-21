import { OperationCandidatePreview } from "./OperationCandidatePreview";
import { ToastNotice } from "../../shared/components/ToastNotice";
import type { FormEvent, RefObject } from "react";
import type { Examinee } from "../../shared/api/examinees";
import type { AssignmentMode, PseudonymAssignment } from "../../shared/api/pseudonyms";
import type { OperationNotice } from "./useOperationCandidateController";

interface Props {
  inputRef?: RefObject<HTMLInputElement | null>;
  previewRef: RefObject<HTMLElement | null>;
  input: string;
  searching: boolean;
  processing?: boolean;
  searchReady?: boolean;
  notice: OperationNotice | null;
  candidate: Examinee | null;
  useCandidatePhotos: boolean;
  photoUrl: string | null;
  selectedMode: AssignmentMode;
  assignment: PseudonymAssignment | null;
  showAttendanceSelection?: boolean;
  useAnswerSheet?: boolean;
  registrationAbsent?: boolean;
  attendanceLocked?: boolean;
  attendanceDisabled?: boolean;
  labelPrintingEnabled?: boolean;
  labelCopies?: number | "";
  labelCopiesValid?: boolean;
  labelTemplateName?: string;
  onLabelCopiesChange?(value: number | ""): void;
  onRegistrationAbsent?(value: boolean): void;
  onAttendanceLocked?(value: boolean): void;
  onSearch(event: FormEvent): void;
  onInput(value: string): void;
  onReset(): void;
  onCloseNotice(): void;
}

export function OperationControlPanel({
  inputRef,
  previewRef,
  input,
  searching,
  processing = false,
  searchReady = true,
  notice,
  candidate,
  useCandidatePhotos,
  photoUrl,
  selectedMode,
  assignment,
  showAttendanceSelection = false,
  useAnswerSheet = false,
  registrationAbsent = false,
  attendanceLocked = false,
  attendanceDisabled = false,
  labelPrintingEnabled = false,
  labelCopies = 1,
  labelCopiesValid = true,
  labelTemplateName,
  onLabelCopiesChange,
  onRegistrationAbsent,
  onAttendanceLocked,
  onSearch,
  onInput,
  onReset,
  onCloseNotice,
}: Props) {
  const lookupLabel = useAnswerSheet ? "답안지" : "수험번호";
  return (
    <aside className="operator-control-panel">
      <form className="operator-lookup" onSubmit={onSearch}>
        <div
          className={`operator-lookup-field ${showAttendanceSelection ? "with-attendance" : ""} ${labelPrintingEnabled ? "with-label-copies" : ""}`}
        >
          <div>
            <input
              ref={inputRef}
              id="operator-examinee-no"
              aria-label={lookupLabel}
              autoFocus
              value={input}
              readOnly={processing}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.repeat || event.nativeEvent.isComposing)) event.preventDefault();
              }}
              onChange={(event) => onInput(useAnswerSheet ? event.target.value : event.target.value.replace(/\s/g, ""))}
              placeholder={showAttendanceSelection ? `${lookupLabel} 입력` : `${lookupLabel} 입력 또는 스캔`}
              title={`${lookupLabel} 입력 또는 스캔`}
            />
            <button
              type="button"
              className="operator-input-clear"
              onClick={onReset}
              disabled={!input || processing || searching}
              aria-label="입력값 지우기"
            >
              ×
            </button>
          </div>
          <button
            className="operator-search-button"
            disabled={searching || processing || !searchReady || !input.trim()}
            aria-label={searching ? "검색 중" : "수험자 검색"}
            title={searching ? "검색 중" : "수험자 검색"}
          >
            {searching ? <span className="operator-search-spinner" /> : <OperatorSearchIcon />}
          </button>
          {labelPrintingEnabled && (
            <label className="operator-lookup-copies" title={labelTemplateName}>
              <span>출력</span>
              <input
                type="number"
                aria-label="라벨 출력 매수"
                min={1}
                max={10}
                step={1}
                value={labelCopies}
                disabled={processing}
                aria-invalid={!labelCopiesValid}
                onChange={(event) => onLabelCopiesChange?.(event.target.value === "" ? "" : Number(event.target.value))}
              />
              <span>매</span>
            </label>
          )}
          {showAttendanceSelection && (
            <fieldset
              className={`operator-attendance-selector ${registrationAbsent ? "absent" : ""}`}
              data-locked={attendanceLocked}
              aria-label="등록 상태"
              disabled={attendanceDisabled || processing || searching || !searchReady}
            >
              <div className="operator-attendance-switch" role="group" aria-label="다음 가번호 등록 상태">
                <button type="button" aria-pressed={!registrationAbsent} onClick={() => onRegistrationAbsent?.(false)}>
                  응시
                </button>
                <button type="button" aria-pressed={registrationAbsent} onClick={() => onRegistrationAbsent?.(true)}>
                  결시
                </button>
              </div>
              <label
                className="operator-attendance-lock"
                title={
                  attendanceLocked
                    ? "고정 해제: 저장 후 응시로 돌아갑니다."
                    : "고정: 저장 후에도 선택한 상태를 유지합니다."
                }
              >
                <input
                  type="checkbox"
                  checked={attendanceLocked}
                  onChange={(event) => onAttendanceLocked?.(event.target.checked)}
                />
                <span>고정</span>
              </label>
            </fieldset>
          )}
        </div>
        {notice && <ToastNotice notice={notice} onClose={onCloseNotice} />}
      </form>
      <OperationCandidatePreview
        previewRef={previewRef}
        candidate={candidate}
        assignment={assignment}
        selectedMode={selectedMode}
        useCandidatePhotos={useCandidatePhotos}
        photoUrl={photoUrl}
      />
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
