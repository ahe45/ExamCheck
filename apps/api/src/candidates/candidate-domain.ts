import type { ExamineeNoUniqueness } from "../uniqueness/number-uniqueness.js";
import { candidateFieldKeys, candidateFields, candidateKey, type CandidateInput } from "./candidate-fields.js";

export class CandidateDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateDomainError";
  }
}

export type CandidateUploadPolicy = "insert-only" | "insert-update" | "all";

export interface CandidateRecord extends CandidateInput {
  id: number;
}

export interface CandidatePhotoReference {
  id: number;
  examineeNo: string;
  photoHash: string | null;
}

export interface CandidatePhotoFile {
  fileName: string;
  mimeType: "image/jpeg" | "image/png";
  content: Buffer;
  contentHash: string;
}

export interface CandidatePhotoMatch extends CandidatePhotoFile {
  candidateRows: CandidatePhotoReference[];
}

export interface CandidatePhotoArchiveFiles {
  files: CandidatePhotoFile[];
  totalFiles: number;
  skippedCount: number;
}

export interface CandidatePhotoArchiveMatches {
  photos: CandidatePhotoMatch[];
  totalFiles: number;
  skippedCount: number;
  duplicateCount: number;
}

export type CandidateImportPlanItem =
  | { action: "insert"; candidate: CandidateInput }
  | { action: "update" | "skip"; candidate: CandidateInput; current: CandidateRecord };

export interface CandidateImportPlan {
  items: CandidateImportPlanItem[];
  totalRows: number;
  inserted: number;
  updated: number;
  skipped: number;
}

const operationalCandidateFields = candidateFields
  .filter((field) => field.operationallyProtected)
  .map((field) => field.key);

export interface CandidatePhotoImportPlanItem {
  action: "upload" | "update" | "skip";
  photo: CandidatePhotoMatch;
}

export interface CandidatePhotoImportPlan {
  items: CandidatePhotoImportPlanItem[];
  totalFiles: number;
  uploaded: number;
  updated: number;
  skipped: number;
  duplicateCount: number;
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function assertCandidateUploadPolicy(
  value: string,
  kind: "workbook" | "photo",
): asserts value is CandidateUploadPolicy {
  if (value === "insert-only" || value === "insert-update" || value === "all") return;
  throw new CandidateDomainError(
    kind === "workbook" ? "기존 데이터 처리 방식을 확인해 주세요." : "기존 사진 처리 방식을 확인해 주세요.",
  );
}

export function normalizeAndValidateCandidate(candidate: CandidateInput, rowNumber: number): CandidateInput {
  const normalized = { ...candidate };
  for (const field of candidateFields) {
    const value = normalized[field.key].trim();
    normalized[field.key] = value;
    if (!field.optional && !value) {
      throw new CandidateDomainError(`${field.label} 값을 입력하세요. (${rowNumber}행)`);
    }
    if (value && field.format === "date" && !isValidCandidateDate(value)) {
      throw new CandidateDomainError(`${field.label} 형식은 yyyy-mm-dd여야 합니다. (${rowNumber}행)`);
    }
    if (value && field.format === "time" && !timePattern.test(value)) {
      throw new CandidateDomainError(`${field.label} 형식은 hh:mm이어야 합니다. (${rowNumber}행)`);
    }
  }
  return normalized;
}

export function isValidCandidateDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isSameCandidate(left: CandidateInput, right: CandidateInput): boolean {
  return candidateFieldKeys.every((key) => String(left[key] || "") === String(right[key] || ""));
}

export function hasCandidateOperationalChanges(left: CandidateInput, right: CandidateInput): boolean {
  return operationalCandidateFields.some((key) => String(left[key] || "") !== String(right[key] || ""));
}

export function assertCandidateNumberUniqueness(
  candidates: readonly CandidateInput[],
  existing: ReadonlyMap<string, CandidateRecord>,
  policy: ExamineeNoUniqueness,
): void {
  assertCandidateIdentityConsistency(candidates, existing);
  if (policy === "SCHEDULE") return;

  const inputCounts = new Map<string, number>();
  for (const candidate of candidates) {
    inputCounts.set(candidate.examineeNo, (inputCounts.get(candidate.examineeNo) || 0) + 1);
  }
  const duplicatedInputCount = [...inputCounts.values()].filter((count) => count > 1).length;
  if (duplicatedInputCount > 0) {
    throw new CandidateDomainError(
      `수험번호 유일 정책이 시스템 전체로 설정되어 있습니다. 업로드 파일에 중복된 수험번호가 ${duplicatedInputCount}개 있습니다.`,
    );
  }

  const existingByNumber = new Map<string, CandidateRecord[]>();
  for (const row of existing.values()) {
    const rows = existingByNumber.get(row.examineeNo) || [];
    rows.push(row);
    existingByNumber.set(row.examineeNo, rows);
  }
  let conflictCount = 0;
  for (const candidate of candidates) {
    const current = existing.get(candidateKey(candidate));
    const rows = existingByNumber.get(candidate.examineeNo) || [];
    if (rows.some((row) => row.id !== current?.id)) conflictCount += 1;
  }
  if (conflictCount > 0) {
    throw new CandidateDomainError(
      `수험번호 유일 정책이 시스템 전체로 설정되어 있습니다. 기존 데이터와 중복되는 수험번호가 ${conflictCount}개 있습니다.`,
    );
  }
}

export function assertCandidateIdentityConsistency(
  candidates: readonly CandidateInput[],
  existing: ReadonlyMap<string, CandidateRecord>,
): void {
  const proposed = new Map<string, CandidateInput>(existing);
  for (const candidate of candidates) proposed.set(candidateKey(candidate), candidate);

  const identityByNumber = new Map<string, { name: string; birth: string }>();
  const conflictingNumbers = new Set<string>();
  for (const candidate of proposed.values()) {
    const identity = { name: candidate.name.trim(), birth: candidate.birth.trim() };
    const current = identityByNumber.get(candidate.examineeNo);
    if (current && (current.name !== identity.name || current.birth !== identity.birth)) {
      conflictingNumbers.add(candidate.examineeNo);
    } else if (!current) {
      identityByNumber.set(candidate.examineeNo, identity);
    }
  }
  if (conflictingNumbers.size > 0) {
    throw new CandidateDomainError(
      `같은 수험번호에 서로 다른 성명 또는 생년월일이 등록될 수 없습니다. 충돌 수험번호가 ${conflictingNumbers.size}개 있습니다.`,
    );
  }
}

export function buildCandidateImportPlan(
  candidates: readonly CandidateInput[],
  existing: ReadonlyMap<string, CandidateRecord>,
  policy: CandidateUploadPolicy,
): CandidateImportPlan {
  const items: CandidateImportPlanItem[] = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const current = existing.get(candidateKey(candidate));
    const same = current ? isSameCandidate(current, candidate) : false;
    if (current && (policy === "insert-only" || (same && policy !== "all"))) {
      items.push({ action: "skip", candidate, current });
      skipped += 1;
    } else if (current) {
      items.push({ action: "update", candidate, current });
      updated += 1;
    } else {
      items.push({ action: "insert", candidate });
      inserted += 1;
    }
  }

  return { items, totalRows: candidates.length, inserted, updated, skipped };
}

export function buildCandidatePreview(
  candidates: readonly CandidateInput[],
  existing: ReadonlyMap<string, CandidateRecord>,
) {
  let insertCount = 0;
  let updateCount = 0;
  let unchangedCount = 0;
  for (const candidate of candidates) {
    const current = existing.get(candidateKey(candidate));
    if (!current) insertCount += 1;
    else if (isSameCandidate(current, candidate)) unchangedCount += 1;
    else updateCount += 1;
  }
  return { totalRows: candidates.length, insertCount, updateCount, unchangedCount };
}

export function matchCandidatePhotos(
  archive: CandidatePhotoArchiveFiles,
  candidateRows: readonly CandidatePhotoReference[],
): CandidatePhotoArchiveMatches {
  const candidatesByNo = new Map<string, CandidatePhotoReference[]>();
  for (const row of candidateRows) {
    const current = candidatesByNo.get(row.examineeNo) || [];
    current.push(row);
    candidatesByNo.set(row.examineeNo, current);
  }
  const candidateNumbers = [...candidatesByNo.keys()].sort((left, right) => right.length - left.length);
  const photos: CandidatePhotoMatch[] = [];
  const matchedNumbers = new Set<string>();
  let skippedCount = archive.skippedCount;
  let duplicateCount = 0;

  for (const photo of archive.files) {
    const stem = photo.fileName.replace(/\.[^.]+$/, "");
    const candidateNo = candidatesByNo.has(stem) ? stem : candidateNumbers.find((value) => stem.includes(value));
    if (!candidateNo) {
      skippedCount += 1;
      continue;
    }
    if (matchedNumbers.has(candidateNo)) {
      duplicateCount += 1;
      continue;
    }
    matchedNumbers.add(candidateNo);
    photos.push({ ...photo, candidateRows: candidatesByNo.get(candidateNo) || [] });
  }

  return { photos, totalFiles: archive.totalFiles, skippedCount, duplicateCount };
}

export function buildCandidatePhotoImportPlan(
  archive: CandidatePhotoArchiveMatches,
  policy: CandidateUploadPolicy,
): CandidatePhotoImportPlan {
  const items: CandidatePhotoImportPlanItem[] = [];
  let uploaded = 0;
  let updated = 0;
  let skipped = archive.skippedCount;

  for (const photo of archive.photos) {
    const existingRows = photo.candidateRows.filter((row) => row.photoHash);
    const same =
      existingRows.length === photo.candidateRows.length &&
      existingRows.every((row) => row.photoHash === photo.contentHash);
    if ((policy === "insert-only" && existingRows.length > 0) || (policy === "insert-update" && same)) {
      items.push({ action: "skip", photo });
      skipped += 1;
    } else if (existingRows.length > 0) {
      items.push({ action: "update", photo });
      updated += 1;
    } else {
      items.push({ action: "upload", photo });
      uploaded += 1;
    }
  }

  return {
    items,
    totalFiles: archive.totalFiles,
    uploaded,
    updated,
    skipped,
    duplicateCount: archive.duplicateCount,
  };
}

export function validateCandidateWorkbookHeaders(actualHeaders: readonly string[]): void {
  const expectedHeaders = candidateFields.map((field) => field.label);
  const differences: string[] = [];
  const columnCount = Math.max(expectedHeaders.length, actualHeaders.length);
  for (let index = 0; index < columnCount; index += 1) {
    const expected = expectedHeaders[index] ?? "(컬럼 없음)";
    const actual = actualHeaders[index] || "(빈 컬럼)";
    if (expected !== actual) differences.push(`${index + 1}번째 컬럼: '${expected}' 필요, 현재 '${actual}'`);
  }
  if (!differences.length) return;

  const countMessage =
    actualHeaders.length === expectedHeaders.length
      ? ""
      : ` 필요한 컬럼은 ${expectedHeaders.length}개이지만 ${actualHeaders.length}개가 확인되었습니다.`;
  const differenceMessage = differences.slice(0, 3).join("; ");
  const remainder = differences.length > 3 ? ` 외 ${differences.length - 3}개` : "";
  throw new CandidateDomainError(
    `업로드 양식의 헤더 구성이 올바르지 않습니다.${countMessage} ${differenceMessage}${remainder}`.trim(),
  );
}
