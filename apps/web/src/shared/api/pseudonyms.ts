import { z } from "zod";
import { apiBlob, apiFetch, saveBlob } from "./client";

const nonnegativeIntegerSchema = z.number().int().nonnegative();
const assignmentModeSchema = z.enum(["RANDOM", "SEQUENTIAL", "MANUAL", "PREASSIGNED"]);
const pseudonymAssignmentMethodSchema = z.enum(["DRAW", "SEQUENTIAL", "MATCHING", "PREASSIGNED"]);
export type AssignmentMode = z.infer<typeof assignmentModeSchema>;
export type PseudonymAssignmentMethod = z.infer<typeof pseudonymAssignmentMethodSchema>;

export const pseudonymTimeRangeSchema = z.object({
  date: z.string(),
  time: z.string(),
  period: z.string(),
  admission: z.string(),
  unit: z.string(),
  major: z.string(),
  building: z.string(),
  room: z.string(),
  rangeStart: nonnegativeIntegerSchema,
  rangeEnd: nonnegativeIntegerSchema,
  nextSequence: nonnegativeIntegerSchema,
});
export type PseudonymTimeRange = z.infer<typeof pseudonymTimeRangeSchema>;

export const pseudonymAssignmentSchema = z.object({
  id: z.number().int().positive(),
  examineeNo: z.string().min(1),
  examineeName: z.string(),
  examName: z.string(),
  pseudonymNumber: z.string().min(1),
  mode: assignmentModeSchema,
  assignedAt: z.string().min(1),
  alreadyAssigned: z.boolean(),
});
export type PseudonymAssignment = z.infer<typeof pseudonymAssignmentSchema>;

export const pseudonymOperationStatusSchema = z.object({
  closed: z.boolean(),
  closedAt: z.string().nullable(),
  closedByLoginId: z.string().nullable(),
  autoAssignedAbsenteeCount: nonnegativeIntegerSchema,
});
export type PseudonymOperationStatus = z.infer<typeof pseudonymOperationStatusSchema>;

export interface PseudonymOperationScope {
  examName: string;
  examDate: string;
  examTime: string;
  periodName: string;
  admissionName: string;
}

export type PseudonymRosterExportField =
  "pseudonymNumber" | "examineeNo" | "name" | "unitName" | "majorName" | "assignedAt" | "status";

export interface PseudonymRosterExportQuery {
  filters: Array<{
    field: PseudonymRosterExportField;
    mode: "include" | "exclude";
    values: string[];
  }>;
  sort?: {
    field: PseudonymRosterExportField;
    direction: "asc" | "desc";
  };
}

export const pseudonymSettingSchema = z.object({
  id: z.number().int().positive(),
  version: nonnegativeIntegerSchema,
  examName: z.string(),
  admissionName: z.string(),
  rangeStart: nonnegativeIntegerSchema,
  rangeEnd: nonnegativeIntegerSchema,
  nextSequence: nonnegativeIntegerSchema,
  assignmentMethod: pseudonymAssignmentMethodSchema,
  autoDrawEnabled: z.boolean(),
  autoDrawDelaySeconds: nonnegativeIntegerSchema,
  printPreassignedLabel: z.boolean(),
  autoAssignAbsenteesOnClose: z.boolean(),
  deleteAbsenteeInfoOnReopen: z.boolean(),
  useCandidatePhotos: z.boolean(),
  enableBulkDraw: z.boolean(),
  ranges: z.array(pseudonymTimeRangeSchema),
});
export type PseudonymSetting = z.infer<typeof pseudonymSettingSchema>;

export const pseudonymSettingsOverviewCardSchema = z.object({
  name: z.string().min(1),
  candidates: nonnegativeIntegerSchema,
  dates: nonnegativeIntegerSchema,
  schedules: nonnegativeIntegerSchema,
  buildings: z.array(z.string()),
  setting: pseudonymSettingSchema.nullable(),
  error: z.boolean(),
});
export type PseudonymSettingsOverviewCard = z.infer<typeof pseudonymSettingsOverviewCardSchema>;

export type UpdatePseudonymSettingInput = Omit<PseudonymSetting, "id" | "version" | "nextSequence" | "ranges"> & {
  expectedVersion: number;
  ranges: Array<Omit<PseudonymTimeRange, "nextSequence">>;
};

export function assignPseudonym(
  token: string,
  examineeNo: string,
  mode: AssignmentMode,
  schedule: { examName: string; examDate: string; examTime: string; periodName: string; admissionName: string },
  manualNumber?: string,
) {
  return apiFetch(
    "/pseudonyms/assignments",
    {
      method: "POST",
      body: JSON.stringify({ examineeNo, mode, ...schedule, ...(manualNumber ? { manualNumber } : {}) }),
    },
    token,
    pseudonymAssignmentSchema,
  );
}

export function fetchPseudonymSetting(token: string, examName: string, admissionName: string) {
  return apiFetch(
    `/pseudonyms/setting?examName=${encodeURIComponent(examName)}&admissionName=${encodeURIComponent(admissionName)}`,
    {},
    token,
    pseudonymSettingSchema,
  );
}

export function fetchPseudonymSettingsOverview(token: string, examName: string) {
  return apiFetch(
    `/pseudonyms/settings-overview?examName=${encodeURIComponent(examName)}`,
    {},
    token,
    z.array(pseudonymSettingsOverviewCardSchema),
  );
}

export function updatePseudonymSetting(token: string, input: UpdatePseudonymSettingInput) {
  return apiFetch(
    "/pseudonyms/setting",
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
    token,
    pseudonymSettingSchema,
  );
}

export function fetchPseudonymOperationStatus(token: string, input: PseudonymOperationScope) {
  const query = new URLSearchParams(Object.entries(input)).toString();
  return apiFetch(`/pseudonyms/operations/status?${query}`, {}, token, pseudonymOperationStatusSchema);
}

export async function downloadPseudonymRosterExcel(
  token: string,
  input: PseudonymOperationScope & { query: PseudonymRosterExportQuery },
  fileName: string,
) {
  const { blob } = await apiBlob(
    "/pseudonyms/operations/export.xlsx",
    {
      method: "POST",
      body: JSON.stringify(input),
      timeoutMs: 2 * 60_000,
    },
    token,
  );
  saveBlob(blob, fileName);
}

export function closePseudonymOperation(token: string, input: PseudonymOperationScope) {
  return apiFetch(
    "/pseudonyms/operations/close",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
    pseudonymOperationStatusSchema,
  );
}
