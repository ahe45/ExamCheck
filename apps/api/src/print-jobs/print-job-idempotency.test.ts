import { ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { CreatePrintJobDto } from "./print-jobs.dto.js";
import { assertMatchingPrintJobRequest, createPrintJobRequestFingerprint } from "./print-job-idempotency.js";

const baseRequest: CreatePrintJobDto = {
  idempotencyKey: "5f4955d9-4625-4b24-802f-f4f19b60c422",
  examineeNo: "10001",
  workstationCode: "GT800-01",
  copies: 1,
  examDate: "2026-08-11",
  examTime: "09:00",
  periodName: "1교시",
  admissionName: "학생부A",
};

describe("print-job request fingerprint", () => {
  it("is deterministic and normalizes the fields normalized by the print lookup", () => {
    const original = createPrintJobRequestFingerprint(baseRequest);
    const normalizedEquivalent = createPrintJobRequestFingerprint({
      ...baseRequest,
      examineeNo: "  10001  ",
      admissionName: "  학생부Ａ  ",
    });

    expect(original).toMatch(/^[0-9a-f]{64}$/);
    expect(normalizedEquivalent).toBe(original);
  });

  it.each([
    ["examineeNo", "10002"],
    ["workstationCode", "GT800-02"],
    ["copies", 2],
    ["examDate", "2026-08-12"],
    ["examTime", "10:00"],
    ["periodName", "2교시"],
    ["admissionName", "학생부B"],
  ] satisfies Array<[keyof CreatePrintJobDto, CreatePrintJobDto[keyof CreatePrintJobDto]]>)(
    "changes the fingerprint when %s changes",
    (field, value) => {
      expect(createPrintJobRequestFingerprint({ ...baseRequest, [field]: value })).not.toBe(
        createPrintJobRequestFingerprint(baseRequest),
      );
    },
  );

  it("accepts only an exact stored fingerprint and rejects legacy null fingerprints", () => {
    const fingerprint = createPrintJobRequestFingerprint(baseRequest);
    expect(() => assertMatchingPrintJobRequest(fingerprint, fingerprint)).not.toThrow();
    expect(() => assertMatchingPrintJobRequest(null, fingerprint)).toThrow(ConflictException);
    expect(() => assertMatchingPrintJobRequest("0".repeat(64), fingerprint)).toThrow(
      "새 요청 키로 다시 시도해 주세요.",
    );
  });
});
