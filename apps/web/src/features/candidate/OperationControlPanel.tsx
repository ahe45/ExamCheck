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
  registrationAbsent?: boolean;
  attendanceLocked?: boolean;
  attendanceDisabled?: boolean;
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
  registrationAbsent = false,
  attendanceLocked = false,
  attendanceDisabled = false,
  onRegistrationAbsent,
  onAttendanceLocked,
  onSearch,
  onInput,
  onReset,
  onCloseNotice,
}: Props) {
  return (
    <aside className="operator-control-panel">
      <form className="operator-lookup" onSubmit={onSearch}>
        <div className={`operator-lookup-field ${showAttendanceSelection ? "with-attendance" : ""}`}>
          <div>
            <input
              ref={inputRef}
              id="operator-examinee-no"
              aria-label="수험번호"
              autoFocus
              value={input}
              readOnly={processing}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.repeat || event.nativeEvent.isComposing)) event.preventDefault();
              }}
              onChange={(event) => onInput(event.target.value.replace(/\s/g, ""))}
              placeholder={showAttendanceSelection ? "수험번호 입력" : "수험번호 입력 또는 스캔"}
              title="수험번호 입력 또는 스캔"
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
            <dt>가번호</dt>
            <dd>
              {assignment?.pseudonymNumber ||
                (selectedMode === "PREASSIGNED" ? candidate?.preassignedNumber : null) ||
                "-"}
            </dd>
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
