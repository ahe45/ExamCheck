import type { CandidateRecord } from "../../shared/api/candidates";

export type AdmissionStatus = "waiting" | "progress" | "complete";

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
}

type DashboardCandidate = Pick<CandidateRecord, "admission" | "assignedNumber">;

export function buildDashboardStatistics(candidates: readonly DashboardCandidate[]): DashboardStatistics {
  const admissions = new Map<string, { total: number; assigned: number }>();
  for (const candidate of candidates) {
    const name = candidate.admission.trim() || "미지정 전형";
    const current = admissions.get(name) ?? { total: 0, assigned: 0 };
    current.total += 1;
    if (candidate.assignedNumber) current.assigned += 1;
    admissions.set(name, current);
  }

  const admissionRows = [...admissions.entries()]
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
  };
}

function percentage(value: number, total: number) {
  return total ? Math.round((value / total) * 1000) / 10 : 0;
}
