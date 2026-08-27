import { CancelButtonIcon, ConfirmButtonIcon } from "../../shared/components/ActionIcons";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import type { BulkRangeCriterion, BulkRangeMode } from "./system-settings-domain";

const bulkRangeCriteria: Array<{ value: BulkRangeCriterion; label: string }> = [
  { value: "date", label: "시험날짜" },
  { value: "period", label: "교시명" },
  { value: "admission", label: "전형명" },
  { value: "unit", label: "모집단위명" },
  { value: "major", label: "전공명" },
  { value: "building", label: "고사건물명" },
  { value: "room", label: "고사실명" },
];

export function BulkRangeModal({
  bulkStart,
  onBulkStartChange,
  bulkMode,
  onBulkModeChange,
  bulkCriteria,
  onBulkCriterionChange,
  onClose,
  onApply,
}: {
  bulkStart: number;
  onBulkStartChange(value: number): void;
  bulkMode: BulkRangeMode;
  onBulkModeChange(value: BulkRangeMode): void;
  bulkCriteria: BulkRangeCriterion[];
  onBulkCriterionChange(index: number, value: string): void;
  onClose(): void;
  onApply(): void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>();
  return (
    <div
      ref={dialogRef}
      className="system-settings-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-range-title"
    >
      <section className="bulk-range-modal">
        <header>
          <div>
            <p>가번호 범위</p>
            <h2 id="bulk-range-title">일괄 설정</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </header>
        <div className="bulk-range-modal-body">
          <label className="bulk-start-field">
            가번호 시작 번호
            <input
              type="number"
              min="1"
              value={bulkStart}
              onChange={(event) => onBulkStartChange(Number(event.target.value))}
              autoFocus
            />
            <small>각 범위의 종료 번호는 일정별 수험생 수에 맞춰 자동 계산됩니다.</small>
          </label>
          <div className="bulk-range-options">
            <label className={bulkMode === "SAME_START" ? "selected" : ""}>
              <input
                type="radio"
                name="bulkMode"
                checked={bulkMode === "SAME_START"}
                onChange={() => onBulkModeChange("SAME_START")}
              />
              <span />
              <div>
                <strong>동일 시작 번호 적용</strong>
                <small>모든 날짜·시간 일정에 입력한 시작 번호를 동일하게 적용합니다.</small>
              </div>
            </label>
            <label className={bulkMode === "CONTINUOUS" ? "selected" : ""}>
              <input
                type="radio"
                name="bulkMode"
                checked={bulkMode === "CONTINUOUS"}
                onChange={() => onBulkModeChange("CONTINUOUS")}
              />
              <span />
              <div>
                <strong>모든 범위를 연속으로 설정</strong>
                <small>첫 일정부터 수험생 수만큼 이어지도록 다음 일정의 시작 번호를 자동 배치합니다.</small>
              </div>
            </label>
          </div>
          {bulkMode === "CONTINUOUS" && (
            <section className="bulk-criteria-section">
              <div className="bulk-criteria-heading">
                <strong>연속 설정 기준</strong>
                <small>선택한 순서대로 일정을 정렬하여 가번호를 연속 배정합니다.</small>
              </div>
              <div className="bulk-criteria-fields">
                {[...bulkCriteria, ...(bulkCriteria.length < bulkRangeCriteria.length ? [""] : [])].map(
                  (criterion, index) => (
                    <label key={index}>
                      <span>{index + 1}순위 기준값</span>
                      <select
                        value={criterion}
                        onChange={(event) => onBulkCriterionChange(index, event.target.value)}
                        aria-label={`${index + 1}순위 연속 설정 기준값`}
                      >
                        <option value="">기준값 선택</option>
                        {bulkRangeCriteria
                          .filter((option) => option.value === criterion || !bulkCriteria.includes(option.value))
                          .map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                      </select>
                    </label>
                  ),
                )}
              </div>
            </section>
          )}
        </div>
        <footer>
          <button type="button" className="exam-ghost-button" onClick={onClose}>
            <CancelButtonIcon />
            <span>취소</span>
          </button>
          <button
            type="button"
            className="exam-primary-button"
            onClick={onApply}
            disabled={bulkStart < 1 || (bulkMode === "CONTINUOUS" && !bulkCriteria.length)}
          >
            <ConfirmButtonIcon />
            <span>적용</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
