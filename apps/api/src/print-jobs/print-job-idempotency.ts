import { createHash } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { normalizeAdmissionName } from "../authorization/admission-policy.js";
import type { CreatePrintJobDto } from "./print-jobs.dto.js";

const PRINT_JOB_REQUEST_FINGERPRINT_VERSION = 1;
const IDEMPOTENCY_REQUEST_CONFLICT_MESSAGE =
  "같은 중복 방지 키가 다른 출력 요청에 사용되었습니다. 새 요청 키로 다시 시도해 주세요.";

export function createPrintJobRequestFingerprint(input: CreatePrintJobDto): string {
  const canonicalRequest = JSON.stringify({
    version: PRINT_JOB_REQUEST_FINGERPRINT_VERSION,
    examineeNo: input.examineeNo.trim(),
    workstationCode: input.workstationCode,
    copies: input.copies,
    examDate: input.examDate,
    examTime: input.examTime,
    periodName: input.periodName,
    admissionName: normalizeAdmissionName(input.admissionName),
  });

  return createHash("sha256").update(canonicalRequest, "utf8").digest("hex");
}

export function assertMatchingPrintJobRequest(storedFingerprint: string | null, requestedFingerprint: string): void {
  if (storedFingerprint !== requestedFingerprint) {
    throw new ConflictException(IDEMPOTENCY_REQUEST_CONFLICT_MESSAGE);
  }
}
