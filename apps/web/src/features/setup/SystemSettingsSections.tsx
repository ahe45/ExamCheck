import type { PseudonymAssignmentMethod } from "../../shared/api/pseudonyms";
import { RefreshButtonIcon, SettingsButtonIcon } from "../../shared/components/ActionIcons";
import { scheduleIdentity, type RangeDraft } from "./system-settings-domain";

const assignmentMethods: Array<{
  value: PseudonymAssignmentMethod;
  title: string;
  description: string;
  badge: string;
}> = [
  {
    value: "DRAW",
    title: "추첨",
    description: "날짜와 시간별 범위 안에서 사용 가능한 가번호를 무작위로 부여합니다.",
    badge: "무작위 부여",
  },
  {
    value: "SEQUENTIAL",
    title: "순차부여",
    description: "날짜와 시간별 범위의 시작 번호부터 사용 가능한 가번호를 순서대로 부여합니다.",
    badge: "순서대로 부여",
  },
  {
    value: "MATCHING",
    title: "매칭",
    description: "수험번호를 인식한 뒤 입력한 가번호를 해당 수험생과 매칭합니다.",
    badge: "직접 매칭",
  },
  {
    value: "PREASSIGNED",
    title: "사전부여",
    description: "업로드 데이터에 미리 등록된 가번호를 불러와 수험생에게 부여합니다.",
    badge: "등록값 사용",
  },
];

export function AssignmentMethodSection({
  assignmentMethod,
  onAssignmentMethodChange,
  autoDrawEnabled,
  onAutoDrawEnabledChange,
  autoDrawDelaySeconds,
  onAutoDrawDelaySecondsChange,
  printPreassignedLabel,
  onPrintPreassignedLabelChange,
}: {
  assignmentMethod: PseudonymAssignmentMethod;
  onAssignmentMethodChange(value: PseudonymAssignmentMethod): void;
  autoDrawEnabled: boolean;
  onAutoDrawEnabledChange(value: boolean): void;
  autoDrawDelaySeconds: number;
  onAutoDrawDelaySecondsChange(value: number): void;
  printPreassignedLabel: boolean;
  onPrintPreassignedLabelChange(value: boolean): void;
}) {
  return (
    <section className="system-setting-card assignment-method-card">
      <header>
        <div>
          <span>01</span>
          <div>
            <h3>가번호 부여 방식 설정</h3>
            <p>사용자 화면에서 운영할 기본 가번호 부여 방식을 선택합니다.</p>
          </div>
        </div>
        <strong>필수 설정</strong>
      </header>
      <div className="assignment-method-list">
        {assignmentMethods.map((method) => (
          <div
            className={`assignment-method-row ${method.value === "DRAW" ? "draw" : ""} ${method.value === "PREASSIGNED" ? "preassigned" : ""} ${assignmentMethod === method.value ? "selected" : ""}`}
            key={method.value}
          >
            <label className="assignment-method-row-choice">
              <input
                type="radio"
                name="assignmentMethod"
                value={method.value}
                checked={assignmentMethod === method.value}
                onChange={() => onAssignmentMethodChange(method.value)}
              />
              <i aria-hidden="true" />
              <span>
                <strong>
                  {method.title}
                  <b>{method.badge}</b>
                </strong>
                <small>{method.description}</small>
              </span>
            </label>
            {method.value === "DRAW" && (
              <div className="assignment-row-auto-option">
                <SettingSwitch
                  title="자동추첨"
                  description="수험번호 조회 후 설정한 시간 뒤 자동으로 추첨합니다."
                  checked={autoDrawEnabled}
                  disabled={assignmentMethod !== "DRAW"}
                  onChange={onAutoDrawEnabledChange}
                />
                {autoDrawEnabled && (
                  <label className={`auto-draw-delay-field ${assignmentMethod !== "DRAW" ? "disabled" : ""}`}>
                    <span>지연시간</span>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={autoDrawDelaySeconds}
                      disabled={assignmentMethod !== "DRAW"}
                      onChange={(event) =>
                        onAutoDrawDelaySecondsChange(Math.min(60, Math.max(1, Number(event.target.value) || 1)))
                      }
                    />
                    <em>초</em>
                  </label>
                )}
              </div>
            )}
            {method.value === "PREASSIGNED" && (
              <div className="assignment-row-print-option">
                <SettingSwitch
                  title="라벨 출력"
                  description="사전부여된 가번호의 라벨 출력 기능을 사용합니다."
                  checked={printPreassignedLabel}
                  disabled={assignmentMethod !== "PREASSIGNED"}
                  onChange={onPrintPreassignedLabelChange}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function OperationPolicySection({
  autoAssignAbsenteesOnClose,
  onAutoAssignAbsenteesOnCloseChange,
  deleteAbsenteeInfoOnReopen,
  onDeleteAbsenteeInfoOnReopenChange,
  useCandidatePhotos,
  onUseCandidatePhotosChange,
  enableBulkDraw,
  onEnableBulkDrawChange,
  assignmentMethod,
}: {
  autoAssignAbsenteesOnClose: boolean;
  onAutoAssignAbsenteesOnCloseChange(value: boolean): void;
  deleteAbsenteeInfoOnReopen: boolean;
  onDeleteAbsenteeInfoOnReopenChange(value: boolean): void;
  useCandidatePhotos: boolean;
  onUseCandidatePhotosChange(value: boolean): void;
  enableBulkDraw: boolean;
  onEnableBulkDrawChange(value: boolean): void;
  assignmentMethod: PseudonymAssignmentMethod;
}) {
  return (
    <section className="system-setting-card operation-policy-card">
      <header>
        <div>
          <span>02</span>
          <div>
            <h3>운영 정책</h3>
            <p>등록 완료(마감) 처리, 사진 표시와 일괄 추첨 기능의 사용 여부를 설정합니다.</p>
          </div>
        </div>
      </header>
      <div className="operation-policy-list">
        <SettingSwitch
          title="등록 완료(마감) 시 결시자 가번호 자동 부여"
          description="전형 등록 완료(마감) 시 가번호가 없는 결시자에게 남은 번호를 자동으로 부여합니다."
          checked={autoAssignAbsenteesOnClose}
          onChange={onAutoAssignAbsenteesOnCloseChange}
        />
        <SettingSwitch
          title="등록 완료(마감) 해제 시 결시자 정보 삭제"
          description="등록 완료(마감) 해제 시 자동 생성된 결시자 가번호와 관련 처리 정보를 함께 삭제합니다."
          checked={deleteAbsenteeInfoOnReopen}
          onChange={onDeleteAbsenteeInfoOnReopenChange}
        />
        <SettingSwitch
          title="수험생 사진 사용"
          description="사용자 화면의 수험생 조회 영역에 업로드된 사진을 표시합니다."
          checked={useCandidatePhotos}
          onChange={onUseCandidatePhotosChange}
        />
        <SettingSwitch
          title="가번호 일괄 추첨 기능 사용"
          description="동일한 날짜와 시간의 미부여 수험생을 대상으로 일괄 추첨 기능을 활성화합니다."
          checked={enableBulkDraw}
          onChange={onEnableBulkDrawChange}
          disabled={assignmentMethod !== "DRAW"}
        />
      </div>
    </section>
  );
}

export function ScheduleRangeSection({
  assignmentMethod,
  ranges,
  rangeCapacity,
  loading,
  onRefresh,
  onOpenBulk,
  onRangeStartChange,
}: {
  assignmentMethod: PseudonymAssignmentMethod;
  ranges: RangeDraft[];
  rangeCapacity: number;
  loading: boolean;
  onRefresh(): void;
  onOpenBulk(): void;
  onRangeStartChange(index: number, value: number): void;
}) {
  return (
    <section className="system-setting-card schedule-range-card">
      <header>
        <div>
          <span>03</span>
          <div>
            <h3>날짜·시간별 가번호 범위</h3>
            <p>
              {assignmentMethod === "DRAW" ? "추첨" : "순차부여"}에 사용할 범위이며 종료 번호는 실제 등록 수험생 수에
              맞춰 자동 계산됩니다.
            </p>
          </div>
        </div>
        <div className="schedule-range-header-actions">
          <strong>
            {ranges.length.toLocaleString()}개 일정 · 총 {rangeCapacity.toLocaleString()}명
          </strong>
          <button type="button" className="exam-outline-button" onClick={onRefresh} disabled={loading}>
            <RefreshButtonIcon />
            <span>새로고침</span>
          </button>
          <button type="button" className="exam-outline-button" onClick={onOpenBulk} disabled={!ranges.length}>
            <SettingsButtonIcon />
            <span>일괄 설정</span>
          </button>
        </div>
      </header>
      {ranges.length ? (
        <div className="schedule-range-grid-wrap">
          <table className="schedule-range-grid">
            <thead>
              <tr>
                <th>시험날짜</th>
                <th>시험시간</th>
                <th>교시명</th>
                <th>전형명</th>
                <th>모집단위명</th>
                <th>전공명</th>
                <th>고사건물명</th>
                <th>고사실명</th>
                <th>배정인원</th>
                <th>시작 번호</th>
                <th>종료 번호</th>
              </tr>
            </thead>
            <tbody>
              {ranges.map((range, index) => (
                <tr className={range.rangeStart < 1 ? "invalid" : ""} key={scheduleIdentity(range)}>
                  <td title={formatDate(range.date)}>{formatDate(range.date)}</td>
                  <td>{range.time}</td>
                  <td title={range.period}>{range.period || "-"}</td>
                  <td title={range.admission}>{range.admission || "-"}</td>
                  <td title={range.unit}>{range.unit || "-"}</td>
                  <td title={range.major}>{range.major || "-"}</td>
                  <td title={range.building}>{range.building || "-"}</td>
                  <td title={range.room}>{range.room || "-"}</td>
                  <td className="schedule-assigned-count">
                    <strong>{range.candidateCount.toLocaleString()}</strong>명
                  </td>
                  <td>
                    <input
                      aria-label={`${formatDate(range.date)} ${range.time} 시작 번호`}
                      type="number"
                      min="1"
                      value={range.rangeStart}
                      onChange={(event) => onRangeStartChange(index, Number(event.target.value))}
                    />
                  </td>
                  <td>
                    <div className="schedule-end-number">
                      <input
                        aria-label={`${formatDate(range.date)} ${range.time} 종료 번호`}
                        type="number"
                        value={range.rangeEnd}
                        readOnly
                        tabIndex={-1}
                      />
                      <small>자동</small>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="schedule-range-empty">
          <strong>등록된 시험 일정이 없습니다.</strong>
          <span>수험생 데이터를 업로드하면 시험 조건별 설정 항목이 자동으로 생성됩니다.</span>
        </div>
      )}
    </section>
  );
}

function SettingSwitch({
  title,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className={`setting-switch-row ${disabled ? "disabled" : ""}`}>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).format(
        date,
      );
}
