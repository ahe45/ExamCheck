import { ToastNotice } from "../../shared/components/ToastNotice";
import { useState, type CSSProperties } from "react";
import { ConfirmButtonIcon, RefreshButtonIcon } from "../../shared/components/ActionIcons";
import {
  type AdmissionStatistic,
  type AdmissionStatus,
  type DashboardBreakdown,
  type DashboardStatistics,
} from "./dashboard-statistics";

interface DashboardProps {
  statistics: DashboardStatistics;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  onRefresh(): void;
  onOpenCandidates(): void;
}

export function AdminDashboard({
  statistics,
  loading,
  error,
  lastUpdated,
  onRefresh,
  onOpenCandidates,
}: DashboardProps) {
  return (
    <section className="admin-standard-view admin-dashboard-view">
      <header className="admin-view-heading">
        <div>
          <h2>전형 운영 대시보드</h2>
          <p>전형별 수험생 등록 현황과 가번호 부여 진행률을 빠르게 확인합니다.</p>
        </div>
        <div className="admin-view-actions">
          <span className="admin-dashboard-updated">
            {lastUpdated ? `마지막 갱신 ${formatDashboardTime(lastUpdated)}` : "데이터 확인 중"}
          </span>
          <button className="exam-outline-button" onClick={onRefresh} disabled={loading}>
            <RefreshButtonIcon />
            <span>{loading ? "갱신 중…" : "새로고침"}</span>
          </button>
        </div>
      </header>
      {error && !loading && <ToastNotice notice={{ kind: "error", text: error }} />}
      <div className="admission-dashboard-content">
        <section className="admission-dashboard-overview">
          <AdmissionSummaryPanel statistics={statistics} />
          <AssignmentRatioPanel statistics={statistics} />
          <AssignmentProgressPanel statistics={statistics} />
        </section>
        <AdmissionStatusSection
          breakdowns={statistics.breakdowns}
          loading={loading}
          onOpenCandidates={onOpenCandidates}
        />
      </div>
    </section>
  );
}

function AdmissionSummaryPanel({ statistics }: { statistics: DashboardStatistics }) {
  return (
    <article className="admission-summary-panel">
      <header>
        <h3>전형 운영 요약</h3>
        <p>등록된 수험생 데이터의 전형 기준</p>
      </header>
      <div>
        <p>
          <span className="summary-dot all" />
          전체 전형<strong>{statistics.admissions.length.toLocaleString()}건</strong>
        </p>
        <p>
          <span className="summary-dot waiting" />
          전형 대기<strong>{statistics.admissionCounts.waiting.toLocaleString()}건</strong>
        </p>
        <p>
          <span className="summary-dot progress" />
          전형 진행<strong>{statistics.admissionCounts.progress.toLocaleString()}건</strong>
        </p>
        <p>
          <span className="summary-dot complete" />
          전형 완료<strong>{statistics.admissionCounts.complete.toLocaleString()}건</strong>
        </p>
      </div>
    </article>
  );
}

function AssignmentRatioPanel({ statistics }: { statistics: DashboardStatistics }) {
  return (
    <article className="admission-ratio-panel">
      <header>
        <h3>수험생 가번호 부여 현황</h3>
        <p>전체 등록 수험생 기준</p>
      </header>
      <div className="admission-ratio-body">
        <div
          className="admission-donut"
          style={{ "--assigned-angle": `${statistics.assignmentRate * 3.6}deg` } as CSSProperties}
        >
          <span>
            <small>전체 대상자</small>
            <strong>{statistics.totalCandidates.toLocaleString()}</strong>
            <i>명</i>
          </span>
        </div>
        <div className="admission-ratio-legend">
          <p>
            <span className="summary-dot waiting" />
            가번호 부여 대기<strong>{statistics.unassignedCandidates.toLocaleString()}명</strong>
            <b>{(100 - statistics.assignmentRate).toFixed(1)}%</b>
          </p>
          <p>
            <span className="summary-dot complete" />
            가번호 부여 완료<strong>{statistics.assignedCandidates.toLocaleString()}명</strong>
            <b>{statistics.assignmentRate.toFixed(1)}%</b>
          </p>
        </div>
      </div>
    </article>
  );
}

function AssignmentProgressPanel({ statistics }: { statistics: DashboardStatistics }) {
  return (
    <article className="admission-progress-panel">
      <header>
        <h3>전체 가번호 부여 진행 현황</h3>
        <p>
          <strong>{statistics.totalCandidates.toLocaleString()}명</strong> 전체 대상자
        </p>
      </header>
      <div className="admission-progress-list">
        <DashboardProgressRow
          label="부여 대기"
          description="전체 대상자 대비"
          value={statistics.unassignedCandidates}
          rate={100 - statistics.assignmentRate}
          tone="waiting"
        />
        <DashboardProgressRow
          label="부여 완료"
          description="전체 대상자 대비"
          value={statistics.assignedCandidates}
          rate={statistics.assignmentRate}
          tone="complete"
        />
      </div>
    </article>
  );
}

function AdmissionStatusSection({
  breakdowns,
  loading,
  onOpenCandidates,
}: {
  breakdowns: DashboardStatistics["breakdowns"];
  loading: boolean;
  onOpenCandidates(): void;
}) {
  const [selectedBreakdown, setSelectedBreakdown] = useState<DashboardBreakdown>("admission");
  const groups = breakdowns[selectedBreakdown];
  const selectedLabel =
    DASHBOARD_BREAKDOWN_OPTIONS.find((option) => option.value === selectedBreakdown)?.label ?? "전형";

  return (
    <section className="admission-status-section">
      <header>
        <div>
          <h3>운영 현황</h3>
          <p>{selectedLabel}별 수험생과 가번호 부여 현황을 표시합니다.</p>
        </div>
        <div className="dashboard-breakdown-control">
          <span className="dashboard-breakdown-label">분류 기준</span>
          <div className="dashboard-breakdown-switch" role="group" aria-label="운영 현황 기준">
            {DASHBOARD_BREAKDOWN_OPTIONS.map((option) => (
              <button
                type="button"
                className={selectedBreakdown === option.value ? "active" : ""}
                aria-pressed={selectedBreakdown === option.value}
                onClick={() => setSelectedBreakdown(option.value)}
                key={option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </header>
      {loading && !groups.length ? (
        <div className="admission-dashboard-empty">운영 현황을 불러오고 있습니다.</div>
      ) : groups.length ? (
        <div className="admission-card-grid">
          {groups.map((group) => (
            <AdmissionStatusCard statistic={group} breakdownLabel={`${selectedLabel}별`} key={group.name} />
          ))}
        </div>
      ) : (
        <div className="admission-dashboard-empty">
          <strong>등록된 수험생 데이터가 없습니다.</strong>
          <span>수험생 데이터 메뉴에서 업로드 양식으로 수험생을 등록해 주세요.</span>
          <button className="exam-primary-button" onClick={onOpenCandidates}>
            <ConfirmButtonIcon />
            <span>수험생 데이터로 이동</span>
          </button>
        </div>
      )}
    </section>
  );
}

function AdmissionStatusCard({ statistic, breakdownLabel }: { statistic: AdmissionStatistic; breakdownLabel: string }) {
  return (
    <article className="admission-status-card">
      <div className="admission-card-state">
        <span className={`summary-dot ${statistic.status}`} />
        {admissionStatusLabel(statistic.status)}
      </div>
      <h4 title={statistic.name}>{statistic.name}</h4>
      <p>{breakdownLabel} 수험생 데이터 기준</p>
      <dl>
        <div>
          <dt>전체 대상자</dt>
          <dd>{statistic.total.toLocaleString()}명</dd>
        </div>
        <div>
          <dt>부여 완료</dt>
          <dd>{statistic.assigned.toLocaleString()}명</dd>
        </div>
        <div>
          <dt>부여 대기</dt>
          <dd>{statistic.unassigned.toLocaleString()}명</dd>
        </div>
      </dl>
      <DashboardCardProgress label="부여율" rate={statistic.assignmentRate} tone="complete" />
      <DashboardCardProgress label="대기율" rate={100 - statistic.assignmentRate} tone="waiting" />
    </article>
  );
}

function DashboardProgressRow({
  label,
  description,
  value,
  rate,
  tone,
}: {
  label: string;
  description: string;
  value: number;
  rate: number;
  tone: "waiting" | "complete";
}) {
  return (
    <div>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <div className="dashboard-progress-track">
        <i className={tone} style={{ width: `${Math.max(0, Math.min(100, rate))}%` }} />
      </div>
      <b>{value.toLocaleString()}명</b>
      <em>{rate.toFixed(1)}%</em>
    </div>
  );
}

function DashboardCardProgress({ label, rate, tone }: { label: string; rate: number; tone: "waiting" | "complete" }) {
  return (
    <div className="admission-card-progress">
      <span>{label}</span>
      <div className="dashboard-progress-track">
        <i className={tone} style={{ width: `${Math.max(0, Math.min(100, rate))}%` }} />
      </div>
      <strong>{rate.toFixed(1)}%</strong>
    </div>
  );
}

function admissionStatusLabel(status: AdmissionStatus) {
  if (status === "complete") return "부여 완료";
  if (status === "progress") return "부여 진행";
  return "부여 대기";
}

const DASHBOARD_BREAKDOWN_OPTIONS: ReadonlyArray<{ value: DashboardBreakdown; label: string }> = [
  { value: "admission", label: "전형" },
  { value: "period", label: "교시" },
  { value: "building", label: "건물" },
  { value: "waitingRoom", label: "대기실" },
];

function formatDashboardTime(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
