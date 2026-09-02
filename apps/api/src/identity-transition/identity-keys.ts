import { createHash } from "node:crypto";
import { normalizeExamineeNumber, normalizeIdentityText } from "./identity-normalization.js";

const IDENTITY_DIGEST_VERSION = "examcheck-identity:v1";

export function cycleCodeForAcademicYear(academicYear: number): string {
  if (!Number.isInteger(academicYear) || academicYear < 2000 || academicYear > 9999) {
    throw new TypeError("Academic year must be a four-digit integer.");
  }
  return `YEAR:${academicYear}`;
}

export function normalizeSourceCode(value: string | null | undefined): string | null {
  const normalized = normalizeIdentityText(value ?? "");
  return normalized ? normalized.toUpperCase() : null;
}

export function admissionIdentityKey(sourceCode: string | null | undefined, displayName: string): Buffer {
  const code = normalizeSourceCode(sourceCode);
  return identityDigest(
    "admission",
    code ? ["CODE", code] : ["NAME", normalizeRequired(displayName, "Admission name")],
  );
}

export function operationSlotIdentityKey(input: {
  examDate: string;
  startTime: string;
  periodCode?: string | null;
  periodName: string;
}): Buffer {
  const periodCode = normalizeSourceCode(input.periodCode);
  return identityDigest("operation-slot", [
    normalizeRequired(input.examDate, "Exam date"),
    normalizeClock(input.startTime),
    periodCode ? "CODE" : "NAME",
    periodCode ?? normalizeRequired(input.periodName, "Period name"),
  ]);
}

export function scheduleSegmentIdentityKey(input: {
  unitCode?: string | null;
  unitName: string;
  majorCode?: string | null;
  majorName: string;
  buildingCode?: string | null;
  buildingName: string;
  roomCode?: string | null;
  roomName: string;
}): Buffer {
  return identityDigest("schedule-segment", [
    canonicalCodeOrName(input.unitCode, input.unitName),
    canonicalCodeOrName(input.majorCode, input.majorName),
    canonicalCodeOrName(input.buildingCode, input.buildingName),
    canonicalCodeOrName(input.roomCode, input.roomName),
  ]);
}

export function candidateSystemScopeKey(examCycleId: number): Buffer {
  return identityDigest("candidate-number-scope", ["SYSTEM", internalId(examCycleId)]);
}

export function candidateScheduleScopeKey(operationSlotId: number): Buffer {
  return identityDigest("candidate-number-scope", ["SCHEDULE", internalId(operationSlotId)]);
}

export function candidateClaimOwnerKey(input: {
  scopeKind: "SYSTEM" | "SCHEDULE";
  candidateId: number;
  registrationId?: number;
}): Buffer {
  if (input.scopeKind === "SYSTEM") {
    return identityDigest("candidate-number-owner", ["CANDIDATE", internalId(input.candidateId)]);
  }
  if (!input.registrationId) throw new TypeError("Schedule-scoped candidate claims require a registration ID.");
  return identityDigest("candidate-number-owner", ["REGISTRATION", internalId(input.registrationId)]);
}

export function pseudonymAdmissionScopeKey(admissionId: number): Buffer {
  return identityDigest("pseudonym-number-scope", ["ADMISSION", internalId(admissionId)]);
}

export function pseudonymScheduleScopeKey(operationSlotId: number): Buffer {
  return identityDigest("pseudonym-number-scope", ["SCHEDULE", internalId(operationSlotId)]);
}

export function defaultPolicyScopeKey(examCycleId: number): Buffer {
  return identityDigest("pseudonym-policy-scope", ["DEFAULT", internalId(examCycleId)]);
}

export function admissionPolicyScopeKey(admissionId: number): Buffer {
  return identityDigest("pseudonym-policy-scope", ["ADMISSION", internalId(admissionId)]);
}

export function sourceRowHash(entityType: string, values: readonly (boolean | number | string | null)[]): Buffer {
  return identityDigest(
    `source:${entityType}`,
    values.map((value) => JSON.stringify(value)),
  );
}

export function normalizeCandidateNumber(value: string): string {
  if (/\p{Cc}/u.test(value)) throw new TypeError("Candidate number must not contain control characters.");
  const normalized = normalizeExamineeNumber(value);
  if (!normalized) throw new TypeError("Candidate number must not be blank.");
  if (normalized.length > 100) throw new TypeError("Candidate number must not exceed 100 characters.");
  return normalized;
}

export interface CanonicalPseudonymNumber {
  value: number;
  displayWidth: number;
}

export function parseCanonicalPseudonymNumber(raw: string | null | undefined): CanonicalPseudonymNumber | null {
  const normalized = normalizeIdentityText(raw ?? "");
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) throw new TypeError("Pseudonym numbers must contain digits only.");
  const value = Number(normalized);
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("Pseudonym number is outside the safe range.");
  return { value, displayWidth: normalized.length };
}

export function displayPseudonymNumber(value: number, displayWidth: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("Pseudonym value must be a positive integer.");
  if (!Number.isSafeInteger(displayWidth) || displayWidth < 1 || displayWidth > 100) {
    throw new TypeError("Pseudonym display width must be between 1 and 100.");
  }
  return String(value).padStart(displayWidth, "0");
}

export function identityDigest(namespace: string, values: readonly string[]): Buffer {
  const hash = createHash("sha256");
  appendLengthPrefixed(hash, IDENTITY_DIGEST_VERSION);
  appendLengthPrefixed(hash, normalizeRequired(namespace, "Identity namespace"));
  for (const value of values) appendLengthPrefixed(hash, value);
  return hash.digest();
}

function appendLengthPrefixed(hash: ReturnType<typeof createHash>, value: string): void {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length).update(bytes);
}

function canonicalCodeOrName(codeValue: string | null | undefined, nameValue: string): string {
  const code = normalizeSourceCode(codeValue);
  return code ? `CODE:${code}` : `NAME:${normalizeIdentityText(nameValue)}`;
}

function normalizeRequired(value: string, label: string): string {
  const normalized = normalizeIdentityText(value);
  if (!normalized) throw new TypeError(`${label} must not be blank.`);
  return normalized;
}

function normalizeClock(value: string): string {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) throw new TypeError("Clock values must use HH:mm or HH:mm:ss.");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) throw new TypeError("Clock value is outside the valid range.");
  return `${match[1]}:${match[2]}:${String(second).padStart(2, "0")}`;
}

function internalId(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("Identity references require a positive ID.");
  return String(value);
}
