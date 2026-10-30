import type { CandidateRecord } from "../../shared/api/candidates";
import type { AttendanceView } from "../../shared/navigation/admin-navigation";

export type AdmissionStatus = "waiting" | "progress" | "complete";
export type DashboardBreakdown = Exclude<AttendanceView, "candidate">;

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
  Partial<
    Pick<CandidateRecord, "building" | "waitingRoom" | "date" | "time" | "period" | "unit" | "major" | "group" | "room">
  >;

export function buildDashboardStatistics(candidates: readonly DashboardCandidate[]): DashboardStatistics {
  const breakdowns = {
    admission: groupDashboardCandidates(candidates, (candidate) => dashboardGroupName(candidate, "admission")),
    unit: groupDashboardCandidates(candidates, (candidate) => dashboardGroupName(candidate, "unit")),
    major: groupDashboardCandidates(candidates, (candidate) => dashboardGroupName(candidate, "major")),
    group: groupDashboardCandidates(candidates, (candidate) => dashboardGroupName(candidate, "group")),
    date: groupDashboardCandidates(candidates, (candidate) => dashboardGroupName(candidate, "date")),
    building: groupDashboardCandidates(candidates, (candidate) => dashboardGroupName(candidate, "building")),
    period: groupDashboardCandidates(candidates, periodGroupName),
    waitingRoom: groupDashboardCandidates(candidates, waitingRoomGroupName),
    room: groupDashboardCandidates(candidates, (candidate) => dashboardGroupName(candidate, "room")),
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
  const groups = new Map<string, { total: number; assigned: number; schedule: string }>();
  for (const candidate of candidates) {
    const name = getName(candidate);
    const date = candidate.date?.trim().replaceAll(".", "-") || "9999-12-31";
    const time = candidate.time?.trim() || "99:99";
    const schedule = `${date} ${time}`;
    const current = groups.get(name) ?? { total: 0, assigned: 0, schedule };
    if (schedule.localeCompare(current.schedule, "ko", { numeric: true }) < 0) current.schedule = schedule;
    current.total += 1;
    if (candidate.assignedNumber) current.assigned += 1;
    groups.set(name, current);
  }

  return [...groups.entries()]
    .sort(
      ([leftName, left], [rightName, right]) =>
        left.schedule.localeCompare(right.schedule, "ko", { numeric: true }) || leftName.localeCompare(rightName, "ko"),
    )
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
    });
}

function periodGroupName(candidate: DashboardCandidate) {
  const name = candidate.period?.trim() || "미지정 교시";
  const date = candidate.date?.trim();
  const time = candidate.time?.trim();
  const schedule = [date?.replaceAll("-", "."), time].filter(Boolean).join(" ");
  return schedule ? `${name} · ${schedule}` : name;
}

export function dashboardGroupName(
  candidate: Omit<DashboardCandidate, "assignedNumber">,
  breakdown: DashboardBreakdown,
): string {
  const admission = candidate.admission.trim() || "미지정 전형";
  const unit = candidate.unit?.trim() || "미지정 모집단위";
  const major = candidate.major?.trim() || "미지정 전공";
  const building = candidate.building?.trim() || "미지정 건물";
  const scheduleCandidate = { ...candidate, assignedNumber: null };
  switch (breakdown) {
    case "admission":
      return admission;
    case "unit":
      return [admission, unit].join(" · ");
    case "major":
      return [admission, unit, major].join(" · ");
    case "group":
      return [admission, unit, major, periodGroupName(scheduleCandidate), candidate.group?.trim() || "미지정 조"].join(
        " · ",
      );
    case "date":
      return candidate.date?.trim().replaceAll("-", ".") || "미지정 날짜";
    case "period":
      return periodGroupName(scheduleCandidate);
    case "building":
      return building;
    case "room":
      return `${building} · ${candidate.room?.trim() || "미지정 고사실"}`;
    case "waitingRoom":
      return waitingRoomGroupName(scheduleCandidate);
  }
}

function waitingRoomGroupName(candidate: DashboardCandidate) {
  const building = candidate.building?.trim() || "미지정 건물";
  const waitingRoom = candidate.waitingRoom?.trim() || "미지정 대기실";
  return `${building} · ${waitingRoom}`;
}

function percentage(value: number, total: number) {
  return total ? Math.round((value / total) * 1000) / 10 : 0;
}
