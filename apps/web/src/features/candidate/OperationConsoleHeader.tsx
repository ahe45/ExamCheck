import type { RefObject } from "react";
import { AppLogoutIcon } from "../../shared/components/ActionIcons";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import type { OperationSchedule } from "../../shared/api/examinees";
import type { AssignmentMode } from "../../shared/api/pseudonyms";
import { assignmentModeDisplay } from "./operation-view-model";

interface Props {
  systemProfile: DeveloperSettings;
  schedule: OperationSchedule;
  roomName?: string;
  candidateCount: number;
  selectedMode: AssignmentMode;
  autoDrawEnabled: boolean;
  autoDrawDelaySeconds: number;
  range: { start: number; end: number };
  settingsOpen: boolean;
  settingsRef: RefObject<HTMLDivElement | null>;
  labelPrintingEnabled: boolean;
  loginId: string;
  onChangeSchedule(): void;
  onToggleSettings(): void;
  onOpenPrinter(): void;
  onResetHistory(): void;
  resetDisabled?: boolean;
  onLogout(): void;
}

export function OperationConsoleHeader({
  systemProfile,
  schedule,
  roomName,
  candidateCount,
  selectedMode,
  autoDrawEnabled,
  autoDrawDelaySeconds,
  range,
  settingsOpen,
  settingsRef,
  labelPrintingEnabled,
  loginId,
  onChangeSchedule,
  onToggleSettings,
  onOpenPrinter,
  onResetHistory,
  resetDisabled,
  onLogout,
}: Props) {
  const mode = assignmentModeDisplay(selectedMode);
  const modeTitle =
    selectedMode === "RANDOM" && autoDrawEnabled ? `추첨(자동 - ${autoDrawDelaySeconds}초)` : mode.short;

  return (
    <header className="operator-console-header">
      <div className="operator-console-brand">
        <span className={systemProfile.logoDataUrl ? "has-image" : ""}>
          {systemProfile.logoDataUrl ? (
            <img src={systemProfile.logoDataUrl} alt={`${systemProfile.schoolName} 로고`} />
          ) : (
            "가"
          )}
        </span>
        <div>
          <small>
            {systemProfile.academicYear}학년도 · {systemProfile.schoolName || "EXAM NUMBER SYSTEM"}
          </small>
          <strong>{systemProfile.systemName}</strong>
        </div>
      </div>
      <section
        className={`operator-header-summary ${selectedMode === "PREASSIGNED" ? "without-range" : ""}`}
        aria-label="현재 고사 요약"
      >
        <div>
          <span>전형명</span>
          <strong>{schedule.admissionName}</strong>
        </div>
        <div>
          <span>시험일자</span>
          <strong>{schedule.date}</strong>
        </div>
        <div>
          <span>시험시간</span>
          <strong>
            {schedule.time} · {schedule.periodName}
          </strong>
        </div>
        <div>
          <span>시험장소</span>
          <strong>{roomName || "미선택"}</strong>
        </div>
        <div>
          <span>대상인원</span>
          <strong>{candidateCount.toLocaleString()}명</strong>
        </div>
        <div className="assignment-summary">
          <span>부여방식</span>
          <strong title={modeTitle}>
            {mode.short}
            {selectedMode === "RANDOM" && autoDrawEnabled ? `(자동 - ${autoDrawDelaySeconds}초)` : ""}
          </strong>
        </div>
        {selectedMode !== "PREASSIGNED" && (
          <div>
            <span>가번호 범위</span>
            <strong>
              {range.start.toLocaleString()} ~ {range.end.toLocaleString()}
            </strong>
          </div>
        )}
      </section>
      <div className="operator-console-actions">
        <button className="operator-change-schedule-button" onClick={onChangeSchedule}>
          <OperatorScheduleIcon />
          교시 변경
        </button>
        <div className="operator-settings-control" ref={settingsRef}>
          <button
            className={`operator-settings-trigger ${settingsOpen ? "active" : ""}`}
            onClick={onToggleSettings}
            aria-expanded={settingsOpen}
            aria-haspopup="menu"
          >
            <OperatorSettingsIcon />
            설정
          </button>
          {settingsOpen && (
            <div className="operator-settings-popover" role="menu" aria-label="사용자 설정">
              {labelPrintingEnabled && (
                <button role="menuitem" onClick={onOpenPrinter}>
                  <OperatorPrinterIcon />
                  <span>
                    <strong>프린터 설정</strong>
                    <small>드라이버와 연결 상태 확인</small>
                  </span>
                </button>
              )}
              <button role="menuitem" onClick={onResetHistory} disabled={resetDisabled}>
                <OperatorResetIcon />
                <span>
                  <strong>이력 초기화</strong>
                  <small>현재 작업된 내용을 모두 지우기</small>
                </span>
              </button>
            </div>
          )}
        </div>
        <div className="operator-account-summary">
          <span className="exam-account-id" title={`로그인 ID: ${loginId}`}>
            {loginId}
          </span>
        </div>
        <button className="operator-logout-button" onClick={onLogout}>
          <AppLogoutIcon />
          <span>로그아웃</span>
        </button>
      </div>
    </header>
  );
}

function OperatorSettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    </svg>
  );
}

function OperatorScheduleIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.8" y="4.2" width="14.4" height="13" rx="2" />
      <path d="M6.2 2.8v2.8M13.8 2.8v2.8M2.8 8h14.4" />
      <circle cx="12.8" cy="12.7" r="2.3" />
      <path d="M12.8 11.5v1.3l.9.6" />
    </svg>
  );
}

function OperatorPrinterIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5.5 7V3.5h9V7M5 14H3.5V8h13v6H15M5.5 11.5h9v5h-9z" />
      <path d="M14 9.7h.1" />
    </svg>
  );
}

function OperatorResetIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4.2 7.2A6.2 6.2 0 1 1 4 12.3M4.2 7.2V3.8M4.2 7.2h3.4" />
    </svg>
  );
}
