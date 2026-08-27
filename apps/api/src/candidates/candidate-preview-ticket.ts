import { createHmac, timingSafeEqual } from "node:crypto";
import type { ExamineeNoUniqueness } from "../uniqueness/number-uniqueness.js";
import { candidateFieldKeys, type CandidateFieldKey } from "./candidate-fields.js";

export type CandidatePreviewKind = "WORKBOOK" | "PHOTO_ARCHIVE";

export interface CandidatePreviewTicketPayload {
  version: 1;
  kind: CandidatePreviewKind;
  actorUserId: number;
  fileChecksum: string;
  stateChecksum: string;
  expiresAt: number;
}

export class CandidatePreviewTicketError extends Error {
  constructor(readonly reason: "INVALID" | "EXPIRED" | "FILE_CHANGED" | "STATE_CHANGED") {
    super(reason);
    this.name = "CandidatePreviewTicketError";
  }
}

export function createCandidatePreviewTicket(payload: CandidatePreviewTicketPayload, secret: string): string {
  assertPayload(payload);
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${signature(encodedPayload, secret)}`;
}

export function verifyCandidatePreviewTicket(
  token: string,
  expected: {
    kind: CandidatePreviewKind;
    actorUserId: number;
    fileChecksum: string;
    now?: number;
  },
  secret: string,
): CandidatePreviewTicketPayload {
  const [encodedPayload, encodedSignature, ...remainder] = token.split(".");
  if (!encodedPayload || !encodedSignature || remainder.length > 0) throw invalidTicket();

  const expectedSignature = signature(encodedPayload, secret);
  const actualBytes = Buffer.from(encodedSignature, "utf8");
  const expectedBytes = Buffer.from(expectedSignature, "utf8");
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes))
    throw invalidTicket();

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw invalidTicket();
  }
  assertPayload(payload);
  if (payload.kind !== expected.kind || payload.actorUserId !== expected.actorUserId) throw invalidTicket();
  if (payload.fileChecksum !== expected.fileChecksum) throw new CandidatePreviewTicketError("FILE_CHANGED");
  if (payload.expiresAt <= (expected.now ?? Date.now())) throw new CandidatePreviewTicketError("EXPIRED");
  return payload;
}

export function candidateWorkbookStateChecksum(
  records: Iterable<{ id: number; updatedAt: Date | string } & Partial<Record<CandidateFieldKey, string>>>,
  secret: string,
  uniqueness: ExamineeNoUniqueness | null = null,
): string {
  return digestState(
    [
      uniqueness,
      [...records]
        .sort((left, right) => left.id - right.id)
        .map((record) => [
          record.id,
          record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt,
          ...candidateFieldKeys.map((key) => record[key] ?? null),
        ]),
    ],
    secret,
  );
}

export function candidatePhotoStateChecksum(
  records: Iterable<{ id: number; examineeNo: string; photoHash: string | null }>,
  secret: string,
): string {
  return digestState(
    [...records]
      .sort((left, right) => left.id - right.id)
      .map((record) => [record.id, record.examineeNo, record.photoHash ?? null]),
    secret,
  );
}

export function assertCandidatePreviewState(expectedChecksum: string, actualChecksum: string): void {
  if (expectedChecksum !== actualChecksum) throw new CandidatePreviewTicketError("STATE_CHANGED");
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function digestState(value: unknown, secret: string): string {
  return createHmac("sha256", secret).update(JSON.stringify(value)).digest("hex");
}

function assertPayload(value: unknown): asserts value is CandidatePreviewTicketPayload {
  if (
    !value ||
    typeof value !== "object" ||
    (value as Partial<CandidatePreviewTicketPayload>).version !== 1 ||
    !["WORKBOOK", "PHOTO_ARCHIVE"].includes(String((value as Partial<CandidatePreviewTicketPayload>).kind)) ||
    !Number.isSafeInteger((value as Partial<CandidatePreviewTicketPayload>).actorUserId) ||
    (value as Partial<CandidatePreviewTicketPayload>).actorUserId! < 1 ||
    !isSha256((value as Partial<CandidatePreviewTicketPayload>).fileChecksum) ||
    !isSha256((value as Partial<CandidatePreviewTicketPayload>).stateChecksum) ||
    !Number.isSafeInteger((value as Partial<CandidatePreviewTicketPayload>).expiresAt)
  ) {
    throw invalidTicket();
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function invalidTicket(): CandidatePreviewTicketError {
  return new CandidatePreviewTicketError("INVALID");
}
