import { z } from "zod";
import { ApiError, apiBlob, apiFetch } from "./client";

export interface Examinee {
  id: number;
  examineeNo: string;
  name: string;
  birthDate: string;
  examName: string;
  examDate: string;
  roomName: string;
  waitingRoom: string;
  seatNo: string;
  labelBarcode: string;
  preassignedNumber: string | null;
  preassignedAvailable: boolean;
  assignedNumber: string | null;
  assignmentMode: "RANDOM" | "SEQUENTIAL" | "MANUAL" | "PREASSIGNED" | null;
  assignedAt: string | null;
  lastPrintedAt?: string | null;
  status: "ACTIVE";
  examTime: string;
  examEndTime: string;
  periodName: string;
  periodCode: string;
  admissionName: string;
  admissionCode: string;
  unitName: string;
  unitCode: string;
  majorName: string;
  majorCode: string;
  buildingName: string;
  buildingCode: string;
  roomCode: string;
  groupName: string;
  opt1: string;
  opt2: string;
  opt3: string;
  absent: boolean;
}

export const operationScheduleSchema = z.object({
  date: z.string().min(1),
  time: z.string().min(1),
  periodName: z.string().min(1),
  admissionName: z.string().min(1),
  buildingNames: z.array(z.string()),
  candidateCount: z.number().int().nonnegative(),
  assignedCount: z.number().int().nonnegative(),
  printedCount: z.number().int().nonnegative(),
  labelPrintingEnabled: z.boolean(),
});
export type OperationSchedule = z.infer<typeof operationScheduleSchema>;

export type OperationScheduleScope = Pick<OperationSchedule, "date" | "time" | "periodName" | "admissionName">;

export interface ExamineeScheduleAssignment {
  examineeNo: string;
  name: string;
  examDate: string;
  examTime: string;
  periodName: string;
  admissionName: string;
  buildingName: string;
  roomName: string;
}

export type ExamineeLookupResult =
  | { status: "CURRENT"; examinee: Examinee }
  | { status: "OTHER_SCHEDULE"; examineeNo: string; name: string; schedules: ExamineeScheduleAssignment[] }
  | { status: "NOT_FOUND"; examineeNo: string };

export async function fetchExamineePhoto(
  examineeNo: string,
  token: string,
  schedule: OperationScheduleScope,
  signal?: AbortSignal,
) {
  try {
    const { blob } = await apiBlob(
      `/examinees/${encodeURIComponent(examineeNo)}/photo?${scheduleQuery(schedule)}`,
      { signal },
      token,
    );
    return blob;
  } catch (reason) {
    if (reason instanceof ApiError && reason.status === 404) return null;
    throw reason;
  }
}

export function fetchExaminee(examineeNo: string, token: string, schedule: OperationScheduleScope) {
  return apiFetch<Examinee>(`/examinees/${encodeURIComponent(examineeNo)}?${scheduleQuery(schedule)}`, {}, token);
}

export function lookupExaminee(
  examineeNo: string,
  token: string,
  schedule: OperationScheduleScope,
  signal?: AbortSignal,
) {
  return apiFetch<ExamineeLookupResult>(
    `/examinees/operation/lookup/${encodeURIComponent(examineeNo)}?${scheduleQuery(schedule)}`,
    { signal },
    token,
  );
}

export function fetchOperationSchedules(token: string) {
  return apiFetch("/examinees/operation/schedules", {}, token, z.array(operationScheduleSchema));
}

export function fetchOperationRoster(token: string, schedule: OperationScheduleScope) {
  return apiFetch<Examinee[]>(`/examinees/operation/roster?${scheduleQuery(schedule)}`, {}, token);
}

function scheduleQuery(schedule: OperationScheduleScope) {
  return new URLSearchParams({
    date: schedule.date,
    time: schedule.time,
    periodName: schedule.periodName,
    admissionName: schedule.admissionName,
  }).toString();
}
