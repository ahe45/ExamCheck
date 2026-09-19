import { z } from "zod";
import { ApiError, apiBlob, apiFetch, saveBlob } from "./client";

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

export interface CandidateListQuery {
  page: number;
  pageSize: number;
  sort: { key: CandidateFieldKey; direction: "asc" | "desc" } | null;
  filters: Partial<Record<CandidateFieldKey, string[]>>;
}
export interface CandidatePage {
  rows: CandidateRecord[];
  total: number;
  page: number;
  pageSize: number;
}
export function fetchCandidatePage(token: string, query: CandidateListQuery, signal?: AbortSignal) {
  return apiFetch<CandidatePage>(
    "/candidates/page",
    { method: "POST", body: JSON.stringify({ query: JSON.stringify(query) }), signal },
    token,
  );
}
export function fetchCandidateFilterValues(token: string, field: CandidateFieldKey) {
  return apiFetch<string[]>(`/candidates/filter-values?field=${encodeURIComponent(field)}`, {}, token);
}
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

export async function importCandidateWorkbook(
  token: string,
  _file: File,
  policy: CandidateUploadPolicy,
  previewToken: string,
  options?: UploadWaitOptions,
) {
  rememberUpload(previewToken, "workbook");
  const result = await apiFetch<{ jobId: string }>(
    `/candidates/import?policy=${encodeURIComponent(policy)}`,
    { method: "POST", headers: { [CANDIDATE_PREVIEW_TOKEN_HEADER]: previewToken } },
    token,
  );
  rememberUpload(result.jobId, "workbook");
  return parseJobResult(candidateImportResultSchema, await waitForCandidateUpload(token, result.jobId, options));
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

export async function importCandidatePhotoArchive(
  token: string,
  _file: File,
  policy: CandidateUploadPolicy,
  previewToken: string,
  options?: UploadWaitOptions,
) {
  rememberUpload(previewToken, "photos");
  const result = await apiFetch<{ jobId: string }>(
    `/candidates/photo-archive?policy=${encodeURIComponent(policy)}`,
    { method: "POST", headers: { [CANDIDATE_PREVIEW_TOKEN_HEADER]: previewToken } },
    token,
  );
  rememberUpload(result.jobId, "photos");
  return parseJobResult(candidatePhotoImportResultSchema, await waitForCandidateUpload(token, result.jobId, options));
}

export function downloadCandidateTemplate(token: string) {
  return downloadCandidateFile("/candidates/template.xlsx", "수험생 업로드 양식.xlsx", token);
}

export async function downloadCandidateData(token: string, query?: CandidateListQuery) {
  const key = "examcheck.pending-export.v1";
  const serialized = JSON.stringify(query ?? {});
  let jobId: string | undefined;
  try {
    const stored = JSON.parse(sessionStorage.getItem(key) || "null");
    if (stored?.query === serialized) jobId = stored.jobId;
  } catch {
    /* Storage may be unavailable. */
  }
  if (!jobId) {
    const job = await apiFetch<{ jobId: string }>(
      "/candidates/exports",
      { method: "POST", body: JSON.stringify({ query: serialized }) },
      token,
    );
    jobId = job.jobId;
    try {
      sessionStorage.setItem(key, JSON.stringify({ jobId, query: serialized }));
    } catch {
      /* Download remains available. */
    }
  }
  try {
    await waitForCandidateUpload(token, jobId);
    await downloadCandidateFile(`/candidates/exports/${encodeURIComponent(jobId)}`, "수험생 데이터.xlsx", token);
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* Storage may be unavailable. */
    }
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) {
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Storage may be unavailable. */
      }
    }
    throw error;
  }
}

async function downloadCandidateFile(path: string, fileName: string, token: string) {
  const { blob } = await apiBlob(path, { timeoutMs: 2 * 60_000 }, token);
  saveBlob(blob, fileName);
}

function parseJobResult<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError("서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.", 502, "INVALID_RESPONSE");
  return result.data;
}
interface UploadWaitOptions {
  signal?: AbortSignal;
  onProgress?(text: string): void;
}
const pendingUploadKey = "examcheck.pending-upload.v1";
function rememberUpload(jobId: string, kind: "workbook" | "photos") {
  try {
    sessionStorage.setItem(pendingUploadKey, JSON.stringify({ jobId, kind }));
  } catch {
    /* Current polling remains available. */
  }
}
export function pendingCandidateUpload(): { jobId: string; kind: "workbook" | "photos" } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(pendingUploadKey) || "null");
    return value && typeof value.jobId === "string" && ["workbook", "photos"].includes(value.kind) ? value : null;
  } catch {
    return null;
  }
}
export async function waitForCandidateUpload(
  token: string,
  jobId: string,
  options?: UploadWaitOptions,
): Promise<unknown> {
  let errors = 0;
  for (;;) {
    options?.signal?.throwIfAborted();
    try {
      const job = await apiFetch<{
        status: string;
        result: unknown;
        error: string | null;
        processed: number;
        total: number;
      }>(`/candidates/uploads/${encodeURIComponent(jobId)}`, { signal: options?.signal }, token);
      errors = 0;
      if (job.status === "PREVIEW" || job.status === "PARSING")
        throw new ApiError("등록이 시작되지 않았습니다. 미리보기에서 등록을 다시 눌러 주세요.", 409);
      if (job.status === "SUCCEEDED" || job.status === "FAILED") {
        try {
          if (pendingCandidateUpload()?.jobId === jobId) sessionStorage.removeItem(pendingUploadKey);
        } catch {
          /* No persistent storage. */
        }
        if (job.status === "FAILED") throw new ApiError(job.error || "등록 작업이 중단되었습니다.", 409);
        return job.result;
      }
      options?.onProgress?.(
        job.status === "QUEUED"
          ? "등록 순서를 기다리는 중…"
          : `등록 중… ${job.processed.toLocaleString()} / ${job.total.toLocaleString()}건`,
      );
    } catch (error) {
      options?.signal?.throwIfAborted();
      if (error instanceof ApiError && error.status < 500) {
        try {
          if (pendingCandidateUpload()?.jobId === jobId) sessionStorage.removeItem(pendingUploadKey);
        } catch {
          /* Storage may be unavailable. */
        }
        throw error;
      }
      if (++errors >= 30)
        throw new Error("서버 연결을 확인해 주세요. 이 화면을 다시 열면 진행 중인 등록 결과를 확인합니다.", {
          cause: error,
        });
      options?.onProgress?.("서버에 다시 연결하여 등록 결과를 확인하는 중…");
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(options?.signal?.reason);
      };
      const timer = setTimeout(() => {
        options?.signal?.removeEventListener("abort", abort);
        resolve();
      }, 1000);
      options?.signal?.addEventListener("abort", abort, { once: true });
    });
  }
}
