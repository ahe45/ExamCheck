export type IdentityBackfillIssueStatus = "OPEN" | "RESOLVED" | "ACCEPTED";

export interface IdentityBackfillIssueSummary {
  code: string;
  count: number;
  status: Exclude<IdentityBackfillIssueStatus, "RESOLVED">;
}

export interface IdentityBackfillReport {
  runId: string;
  status: "SUCCEEDED" | "BLOCKED" | "FAILED";
  sourceHighWaterMark: number;
  sourceCandidateCount: number;
  targetRegistrationCount: number;
  targetCandidateCount: number;
  exactAssignmentCount: number;
  legacyReservationCount: number;
  acceptedIssueCount: number;
  blockingIssueCount: number;
  issueSummary: IdentityBackfillIssueSummary[];
}

export interface IdentityBackfillOptions {
  confirmIsolatedCopy: boolean;
  examName: string;
  chunkSize?: number;
  runId?: string;
}

export type SafeIssueDetails = Readonly<Record<string, number | boolean | null>>;

export const IDENTITY_BACKFILL_ADVISORY_LOCK = "examcheck_identity_backfill_v1";
export const DEFAULT_IDENTITY_BACKFILL_CHUNK_SIZE = 100;
