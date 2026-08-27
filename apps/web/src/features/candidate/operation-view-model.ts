import type { Examinee, OperationSchedule } from "../../shared/api/examinees";
import type {
  AssignmentMode,
  PseudonymAssignment,
  PseudonymOperationScope,
  PseudonymRosterExportQuery,
} from "../../shared/api/pseudonyms";

export interface OperationRow {
  candidate: Examinee;
  assignment: PseudonymAssignment | null;
}

export type OperationFieldKey =
  "pseudonymNumber" | "examineeNo" | "name" | "unitName" | "majorName" | "assignedAt" | "status";

export interface OperationColumn {
  key: OperationFieldKey;
  label: string;
  wide?: boolean;
}

export const operationColumns: OperationColumn[] = [
  { key: "pseudonymNumber", label: "가번호" },
  { key: "examineeNo", label: "수험번호" },
  { key: "name", label: "성명" },
  { key: "unitName", label: "모집단위", wide: true },
  { key: "majorName", label: "전공", wide: true },
  { key: "assignedAt", label: "등록일시" },
  { key: "status", label: "상태" },
];

export function assignmentFromExaminee(candidate: Examinee): PseudonymAssignment | null {
  if (!candidate.assignedNumber || !candidate.assignmentMode) return null;
  return {
    id: 0,
    examineeNo: candidate.examineeNo,
    examineeName: candidate.name,
    examName: candidate.examName,
    pseudonymNumber: candidate.assignedNumber,
    mode: candidate.assignmentMode,
    assignedAt: candidate.assignedAt || "",
    alreadyAssigned: true,
  };
}

export function toOperationRows(candidates: Examinee[]): OperationRow[] {
  return candidates.map((candidate) => ({ candidate, assignment: assignmentFromExaminee(candidate) }));
}

export function operationRowStatus(row: OperationRow): "등록" | "대기" | "결시" {
  if (row.candidate.absent) return "결시";
  return row.assignment ? "등록" : "대기";
}

export function operationRowValue(row: OperationRow, key: OperationFieldKey): string {
  if (key === "pseudonymNumber") return row.assignment?.pseudonymNumber || "-";
  if (key === "examineeNo") return row.candidate.examineeNo;
  if (key === "name") return row.candidate.name;
  if (key === "unitName") return row.candidate.unitName || "-";
  if (key === "majorName") return row.candidate.majorName || "-";
  if (key === "assignedAt") return formatRegistrationTimestamp(row.assignment?.assignedAt || "");
  return operationRowStatus(row);
}

export function formatRegistrationTimestamp(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const twoDigits = (part: number) => String(part).padStart(2, "0");
  return `${twoDigits(date.getFullYear() % 100)}.${twoDigits(date.getMonth() + 1)}.${twoDigits(date.getDate())}. ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}`;
}

export function formatScheduleDate(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${year}.${month}.${day}` : value;
}

export function safeFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

export function operationScope(schedule: OperationSchedule, examName: string): PseudonymOperationScope {
  return {
    examName,
    examDate: schedule.date,
    examTime: schedule.time,
    periodName: schedule.periodName,
    admissionName: schedule.admissionName,
  };
}

export function operationRosterStats(rows: OperationRow[]) {
  const assignedCount = rows.filter((row) => row.assignment).length;
  const presentCount = rows.filter((row) => row.assignment && !row.candidate.absent).length;
  return {
    totalCount: rows.length,
    assignedCount,
    presentCount,
    attendanceRate: rows.length ? (presentCount / rows.length) * 100 : 0,
    attendanceRateText: rows.length ? ((presentCount / rows.length) * 100).toFixed(1) : "0.0",
  };
}

export function toRosterExportQuery(
  filters: Partial<Record<OperationFieldKey, string[]>>,
  sort: { key: OperationFieldKey; direction: "asc" | "desc" } | null,
): PseudonymRosterExportQuery {
  return {
    filters: operationColumns.flatMap((column) => {
      const values = filters[column.key] ?? [];
      return values.length ? [{ field: column.key, mode: "include" as const, values: [...new Set(values)] }] : [];
    }),
    ...(sort ? { sort: { field: sort.key, direction: sort.direction } } : {}),
  };
}

export function assignmentActionLabel(mode: AssignmentMode): string {
  if (mode === "RANDOM") return "가번호 추첨";
  if (mode === "SEQUENTIAL") return "다음 가번호 부여";
  if (mode === "MANUAL") return "입력한 가번호 부여";
  return "사전 가번호 불러오기";
}

export function assignmentModeDisplay(mode: AssignmentMode): { short: string; label: string } {
  if (mode === "RANDOM") return { short: "추첨", label: "범위 내 무작위 부여" };
  if (mode === "SEQUENTIAL") return { short: "순차", label: "범위 내 순차부여" };
  if (mode === "MANUAL") return { short: "매칭", label: "가번호 직접 매칭" };
  return { short: "사전", label: "등록된 가번호 사용" };
}

interface DrawViewModelInput {
  assignment: PseudonymAssignment | null;
  previewNumber: number;
  autoDrawEnabled: boolean;
  remainingMs: number;
  delaySeconds: number;
  canAssign: boolean;
  assigning: boolean;
}

export function drawViewModel(input: DrawViewModelInput) {
  const complete = Boolean(input.assignment);
  const durationMs = Math.max(1, input.delaySeconds * 1000);
  return {
    complete,
    className: `operator-draw-popover ${complete ? "complete" : "rolling"}`,
    title: complete ? "추첨 완료" : "가번호 추첨",
    displayNumber: input.assignment?.pseudonymNumber || input.previewNumber.toLocaleString(),
    showCountdown: !complete && input.autoDrawEnabled,
    countdownProgress: Math.max(0, Math.min(100, (input.remainingMs / durationMs) * 100)),
    remainingSecondsText: Math.max(0, input.remainingMs / 1000).toFixed(1),
    actionLabel: input.assigning ? "추첨 중…" : input.autoDrawEnabled ? "지금 추첨" : "가번호 추첨",
    actionDisabled: !input.canAssign || input.assigning,
  };
}
