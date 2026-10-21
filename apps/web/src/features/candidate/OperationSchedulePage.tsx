import { ToastNotice } from "../../shared/components/ToastNotice";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { AuthUser } from "../../shared/api/auth";
import { fetchOperationSchedules, type OperationSchedule } from "../../shared/api/examinees";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import { AppLogoutIcon } from "../../shared/components/ActionIcons";

export function OperationSchedulePage({
  token,
  user,
  systemProfile,
  onSelect,
  onLogout,
}: {
  token: string;
  user: AuthUser;
  systemProfile: DeveloperSettings;
  onSelect(schedule: OperationSchedule): void;
  onLogout(): void;
}) {
  const [schedules, setSchedules] = useState<OperationSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});
  const accordionId = useId();
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const dates = useMemo(() => [...new Set(schedules.map((item) => item.date))], [schedules]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchOperationSchedules(token);
      setSchedules(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "운영 일정을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="operation-select-page">
      <header className="operation-select-topbar">
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
        <div className="operation-select-account">
          <span className="exam-account-id" title={`로그인 ID: ${user.loginId}`}>
            {user.loginId}
          </span>
          <button onClick={onLogout}>
            <AppLogoutIcon />
            <span>로그아웃</span>
          </button>
        </div>
      </header>
      <main className="operation-select-main operation-date-section-list">
        {error && <ToastNotice notice={{ kind: "error", text: error }} onClose={() => setError(null)} />}
        {loading ? (
          <section className="operation-select-empty">
            <p>운영 일정을 불러오는 중입니다.</p>
          </section>
        ) : !schedules.length ? (
          <section className="operation-select-empty">
            <span>!</span>
            <h2>선택할 수 있는 운영 일정이 없습니다.</h2>
            <p>
              {user.admissionNames.length
                ? "배정된 전형에 등록된 수험생 일정이 없습니다. 관리자에게 수험생 데이터를 확인해 달라고 요청해 주세요."
                : "등록된 전형·교시 일정이 없습니다. 관리자에게 수험생 데이터를 확인해 달라고 요청해 주세요."}
            </p>
          </section>
        ) : (
          dates.map((date) => {
            const dateSchedules = schedules.filter((item) => item.date === date);
            const expanded = expandedDates[date] ?? date === today;
            return (
              <section className="operation-schedule-section operation-date-section" key={date}>
                <header>
                  <h2>
                    <button
                      type="button"
                      className="operation-date-accordion-toggle"
                      aria-expanded={expanded}
                      aria-controls={accordionId + date}
                      onClick={() => setExpandedDates((current) => ({ ...current, [date]: !expanded }))}
                    >
                      <span className="operation-date-accordion-title">
                        <small>시험 날짜</small>
                        <span>{formatDate(date)}</span>
                      </span>
                      <span className="operation-date-accordion-meta">
                        <span>{dateSchedules.length}개 교시</span>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </span>
                    </button>
                  </h2>
                </header>
                <div className="operation-schedule-grid" id={accordionId + date} hidden={!expanded}>
                  {dateSchedules.map((schedule) => {
                    const completedCount = schedule.labelPrintingEnabled
                      ? schedule.printedCount
                      : schedule.assignedCount;
                    const completedLabel = schedule.labelPrintingEnabled ? "출력 완료" : "부여 완료";
                    const rate = schedule.candidateCount ? (completedCount / schedule.candidateCount) * 100 : 0;
                    return (
                      <button
                        className="operation-schedule-card"
                        key={`${schedule.date}|${schedule.time}|${schedule.periodName}|${schedule.admissionName}`}
                        onClick={() => onSelect(schedule)}
                      >
                        <div className="operation-schedule-time">
                          <span>시험 시간</span>
                          <strong>{schedule.time}</strong>
                        </div>
                        <div className="operation-schedule-copy">
                          <small>교시명</small>
                          <h3>{schedule.periodName}</h3>
                          <div className="operation-schedule-details">
                            <p>
                              <span>전형명</span>
                              <strong>{schedule.admissionName}</strong>
                            </p>
                            <p>
                              <span>고사건물명</span>
                              <strong>
                                {schedule.buildingNames.length ? schedule.buildingNames.join(" · ") : "-"}
                              </strong>
                            </p>
                          </div>
                          <p className="operation-schedule-counts">
                            <span>
                              대상자 <b>{schedule.candidateCount.toLocaleString()}명</b>
                            </span>
                            <span>
                              {completedLabel} <b>{completedCount.toLocaleString()}명</b>
                            </span>
                          </p>
                          <div
                            className="operation-schedule-progress"
                            role="progressbar"
                            aria-label={`${schedule.periodName} ${completedLabel}`}
                            aria-valuemin={0}
                            aria-valuemax={schedule.candidateCount}
                            aria-valuenow={completedCount}
                          >
                            <i style={{ width: `${rate}%` }} />
                          </div>
                        </div>
                        <span className="operation-schedule-enter">
                          운영 시작 <b>→</b>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </main>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(
        date,
      );
}
