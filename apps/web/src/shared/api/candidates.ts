import { z } from "zod";
import { apiBlob, apiFetch, saveBlob } from "./client";

export const CANDIDATE_PREVIEW_TOKEN_HEADER = "X-Candidate-Preview-Token";

export type CandidateFieldKey =
  | "designatedSort"
  | "date"
  | "time"
  | "period"
  | "admission"
  | "unit"
  | "major"
  | "building"
  | "waitingRoom"
  | "room"
  | "examineeNo"
  | "temporaryNo"
  | "name"
  | "birth"
  | "group"
  | "opt1"
  | "opt2"
  | "opt3";

export interface CandidateRecord extends Record<CandidateFieldKey, string> {
  id: number;
  assignedNumber: string | null;
  assignedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const nonnegativeIntegerSchema = z.number().int().nonnegative();
const percentageSchema = z.number().min(0).max(100);
const candidateDashboardAdmissionStatusSchema = z.enum(["waiting", "progress", "complete"]);
const candidateDashboardAdmissionSchema = z.object({
  name: z.string().min(1),
  total: nonnegativeIntegerSchema,
  assigned: nonnegativeIntegerSchema,
  unassigned: nonnegativeIntegerSchema,
  assignmentRate: percentageSchema,
  status: candidateDashboardAdmissionStatusSchema,
});
const candidateDashboardBreakdownsSchema = z.object({
  admission: z.array(candidateDashboardAdmissionSchema),
  building: z.array(candidateDashboardAdmissionSchema),
  period: z.array(candidateDashboardAdmissionSchema),
  waitingRoom: z.array(candidateDashboardAdmissionSchema),
});
export const candidateDashboardSummarySchema = z.object({
  totalCandidates: nonnegativeIntegerSchema,
  assignedCandidates: nonnegativeIntegerSchema,
  unassignedCandidates: nonnegativeIntegerSchema,
  assignmentRate: percentageSchema,
  admissions: z.array(candidateDashboardAdmissionSchema),
  admissionCounts: z.object({
    waiting: nonnegativeIntegerSchema,
    progress: nonnegativeIntegerSchema,
    complete: nonnegativeIntegerSchema,
  }),
  breakdowns: candidateDashboardBreakdownsSchema,
});
export type CandidateDashboardAdmissionStatus = z.infer<typeof candidateDashboardAdmissionStatusSchema>;
export type CandidateDashboardAdmission = z.infer<typeof candidateDashboardAdmissionSchema>;
export type CandidateDashboardSummary = z.infer<typeof candidateDashboardSummarySchema>;

export const candidateUploadPreviewSchema = z.object({
  fileName: z.string().min(1),
  previewToken: z.string().min(1).max(2048),
  totalRows: nonnegativeIntegerSchema,
  insertCount: nonnegativeIntegerSchema,
  updateCount: nonnegativeIntegerSchema,
  unchangedCount: nonnegativeIntegerSchema,
});
export type CandidateUploadPreview = z.infer<typeof candidateUploadPreviewSchema>;

export const candidateImportResultSchema = z.object({
  totalRows: nonnegativeIntegerSchema,
  inserted: nonnegativeIntegerSchema,
  updated: nonnegativeIntegerSchema,
  skipped: nonnegativeIntegerSchema,
});
export type CandidateImportResult = z.infer<typeof candidateImportResultSchema>;

export const candidatePhotoPreviewSchema = z.object({
  fileName: z.string().min(1),
  previewToken: z.string().min(1).max(2048),
  totalFiles: nonnegativeIntegerSchema,
  matchedCount: nonnegativeIntegerSchema,
  skippedCount: nonnegativeIntegerSchema,
  duplicateCount: nonnegativeIntegerSchema,
});
export type CandidatePhotoPreview = z.infer<typeof candidatePhotoPreviewSchema>;

export const candidatePhotoImportResultSchema = z.object({
  totalFiles: nonnegativeIntegerSchema,
  uploaded: nonnegativeIntegerSchema,
  updated: nonnegativeIntegerSchema,
  skipped: nonnegativeIntegerSchema,
  duplicateCount: nonnegativeIntegerSchema,
});
export type CandidatePhotoImportResult = z.infer<typeof candidatePhotoImportResultSchema>;

export type CandidateUploadPolicy = "insert-only" | "insert-update" | "all";

export function fetchCandidates(token: string) {
  return apiFetch<CandidateRecord[]>("/candidates", {}, token);
}

export function fetchCandidateDashboardSummary(token: string) {
  return apiFetch("/candidates/dashboard-summary", {}, token, candidateDashboardSummarySchema);
}

export function previewCandidateWorkbook(token: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  return apiFetch(
    "/candidates/import/preview",
    { method: "POST", body, timeoutMs: 5 * 60_000 },
    token,
    candidateUploadPreviewSchema,
  );
}

export function importCandidateWorkbook(
  token: string,
  file: File,
  policy: CandidateUploadPolicy,
  previewToken: string,
) {
  const body = new FormData();
  body.append("file", file);
  return apiFetch(
    `/candidates/import?policy=${encodeURIComponent(policy)}`,
    {
      method: "POST",
      body,
      headers: { [CANDIDATE_PREVIEW_TOKEN_HEADER]: previewToken },
      timeoutMs: 5 * 60_000,
    },
    token,
    candidateImportResultSchema,
  );
}

export function previewCandidatePhotoArchive(token: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  return apiFetch(
    "/candidates/photo-archive/preview",
    { method: "POST", body, timeoutMs: 5 * 60_000 },
    token,
    candidatePhotoPreviewSchema,
  );
}

export function importCandidatePhotoArchive(
  token: string,
  file: File,
  policy: CandidateUploadPolicy,
  previewToken: string,
) {
  const body = new FormData();
  body.append("file", file);
  return apiFetch(
    `/candidates/photo-archive?policy=${encodeURIComponent(policy)}`,
    {
      method: "POST",
      body,
      headers: { [CANDIDATE_PREVIEW_TOKEN_HEADER]: previewToken },
      timeoutMs: 5 * 60_000,
    },
    token,
    candidatePhotoImportResultSchema,
  );
}

export function downloadCandidateTemplate(token: string) {
  return downloadCandidateFile("/candidates/template.xlsx", "수험생 업로드 양식.xlsx", token);
}

export function downloadCandidateData(token: string) {
  return downloadCandidateFile("/candidates/export.xlsx", "수험생 데이터.xlsx", token);
}

async function downloadCandidateFile(path: string, fileName: string, token: string) {
  const { blob } = await apiBlob(path, { timeoutMs: 2 * 60_000 }, token);
  saveBlob(blob, fileName);
}
