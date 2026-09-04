import type { CandidateRecord } from "../../shared/api/candidates";

export type AdmissionStatus = "waiting" | "progress" | "complete";
export type DashboardBreakdown = "admission" | "building" | "period" | "waitingRoom";

export interface AdmissionStatistic {
  name: string;
  total: number;
  assigned: number;
  unassigned: number;
  assignmentRate: number;
  status: AdmissionStatus;
}

export interface DashboardStatistics {
  totalCandidates: number;
  assignedCandidates: number;
  unassignedCandidates: number;
  assignmentRate: number;
  admissions: AdmissionStatistic[];
  admissionCounts: Record<AdmissionStatus, number>;
  breakdowns: Record<DashboardBreakdown, AdmissionStatistic[]>;
}

type DashboardCandidate = Pick<CandidateRecord, "admission" | "assignedNumber"> &
  Partial<Pick<CandidateRecord, "building" | "waitingRoom" | "date" | "time" | "period">>;

export function buildDashboardStatistics(candidates: readonly DashboardCandidate[]): DashboardStatistics {
  const breakdowns = {
    admission: groupDashboardCandidates(candidates, (candidate) => candidate.admission.trim() || "미지정 전형"),
    building: groupDashboardCandidates(candidates, (candidate) => candidate.building?.trim() || "미지정 건물"),
    period: groupDashboardCandidates(candidates, periodGroupName),
    waitingRoom: groupDashboardCandidates(candidates, waitingRoomGroupName),
  };
  const admissionRows = breakdowns.admission;
  const assignedCandidates = candidates.filter((candidate) => Boolean(candidate.assignedNumber)).length;
  const admissionCounts = admissionRows.reduce<Record<AdmissionStatus, number>>(
    (counts, admission) => {
      counts[admission.status] += 1;
      return counts;
    },
    { waiting: 0, progress: 0, complete: 0 },
  );

  return {
    totalCandidates: candidates.length,
    assignedCandidates,
    unassignedCandidates: candidates.length - assignedCandidates,
    assignmentRate: percentage(assignedCandidates, candidates.length),
    admissions: admissionRows,
    admissionCounts,
    breakdowns,
  };
}

function groupDashboardCandidates(
  candidates: readonly DashboardCandidate[],
  getName: (candidate: DashboardCandidate) => string,
): AdmissionStatistic[] {
  const groups = new Map<string, { total: number; assigned: number }>();
  for (const candidate of candidates) {
    const name = getName(candidate);
    const current = groups.get(name) ?? { total: 0, assigned: 0 };
    current.total += 1;
    if (candidate.assignedNumber) current.assigned += 1;
    groups.set(name, current);
  }

  return [...groups.entries()]
    .map(([name, value]): AdmissionStatistic => {
      const assignmentRate = percentage(value.assigned, value.total);
      const status: AdmissionStatus =
        value.assigned === 0 ? "waiting" : value.assigned === value.total ? "complete" : "progress";
      return {
        name,
        total: value.total,
        assigned: value.assigned,
        unassigned: value.total - value.assigned,
        assignmentRate,
        status,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "ko"));
}

function periodGroupName(candidate: DashboardCandidate) {
  const name = candidate.period?.trim() || "미지정 교시";
  const date = candidate.date?.trim();
  const time = candidate.time?.trim();
  const schedule = [date?.replaceAll("-", "."), time].filter(Boolean).join(" ");
  return schedule ? `${name} · ${schedule}` : name;
}

function waitingRoomGroupName(candidate: DashboardCandidate) {
  const building = candidate.building?.trim() || "미지정 건물";
  const waitingRoom = candidate.waitingRoom?.trim() || "미지정 대기실";
  return `${building} · ${waitingRoom}`;
}

function percentage(value: number, total: number) {
  return total ? Math.round((value / total) * 1000) / 10 : 0;
}
