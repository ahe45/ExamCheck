import { describe, expect, it } from "vitest";
import {
  admissionIdentityKey,
  admissionPolicyScopeKey,
  candidateClaimOwnerKey,
  candidateScheduleScopeKey,
  candidateSystemScopeKey,
  cycleCodeForAcademicYear,
  defaultPolicyScopeKey,
  displayPseudonymNumber,
  identityDigest,
  normalizeCandidateNumber,
  normalizeSourceCode,
  operationSlotIdentityKey,
  parseCanonicalPseudonymNumber,
  pseudonymAdmissionScopeKey,
  pseudonymScheduleScopeKey,
  scheduleSegmentIdentityKey,
  sourceRowHash,
} from "./identity-keys.js";

describe("target identity keys", () => {
  it("uses a stable annual cycle code", () => {
    expect(cycleCodeForAcademicYear(2026)).toBe("YEAR:2026");
    expect(() => cycleCodeForAcademicYear(26)).toThrow("Academic year");
    expect(() => cycleCodeForAcademicYear(2026.5)).toThrow("Academic year");
    expect(() => cycleCodeForAcademicYear(10_000)).toThrow("Academic year");
  });

  it("normalizes names and prefers stable source codes", () => {
    expect(admissionIdentityKey(" a-01 ", "기존명")).toEqual(admissionIdentityKey("A-01", "변경명"));
    expect(admissionIdentityKey("", "Ａ 전형 ")).toEqual(admissionIdentityKey(null, "A 전형"));
  });

  it("normalizes clock values without using room data in slot identity", () => {
    expect(operationSlotIdentityKey({ examDate: "2026-09-01", startTime: "09:00", periodName: "1교시" })).toEqual(
      operationSlotIdentityKey({ examDate: "2026-09-01", startTime: "09:00:00", periodName: "1교시" }),
    );
    expect(
      operationSlotIdentityKey({
        examDate: "2026-09-01",
        startTime: "09:00:07",
        periodCode: " p-1 ",
        periodName: "변경된 명칭",
      }),
    ).toEqual(
      operationSlotIdentityKey({
        examDate: "2026-09-01",
        startTime: "09:00:07",
        periodCode: "P-1",
        periodName: "원래 명칭",
      }),
    );
    expect(() => operationSlotIdentityKey({ examDate: "", startTime: "09:00", periodName: "1교시" })).toThrow(
      "Exam date",
    );
    expect(() => operationSlotIdentityKey({ examDate: "2026-09-01", startTime: "9:00", periodName: "1교시" })).toThrow(
      "HH:mm",
    );
    for (const startTime of ["24:00", "23:60", "23:59:60"]) {
      expect(() => operationSlotIdentityKey({ examDate: "2026-09-01", startTime, periodName: "1교시" })).toThrow(
        "valid range",
      );
    }
  });

  it("uses all four approved segment dimensions", () => {
    const base = {
      unitName: "교육학부",
      majorName: "",
      buildingName: "본관",
      roomName: "101호",
    };
    expect(scheduleSegmentIdentityKey(base)).not.toEqual(scheduleSegmentIdentityKey({ ...base, roomName: "102호" }));
    expect(
      scheduleSegmentIdentityKey({
        ...base,
        unitCode: " unit-1 ",
        majorCode: "major-1",
        buildingCode: "building-1",
        roomCode: "room-1",
      }),
    ).toEqual(
      scheduleSegmentIdentityKey({
        ...base,
        unitCode: "UNIT-1",
        majorCode: "MAJOR-1",
        buildingCode: "BUILDING-1",
        roomCode: "ROOM-1",
      }),
    );
  });

  it("keeps cycle and schedule number scopes distinct", () => {
    expect(candidateSystemScopeKey(1)).not.toEqual(candidateScheduleScopeKey(1));
    expect(candidateClaimOwnerKey({ scopeKind: "SYSTEM", candidateId: 7 })).toEqual(
      candidateClaimOwnerKey({ scopeKind: "SYSTEM", candidateId: 7, registrationId: 8 }),
    );
    expect(candidateClaimOwnerKey({ scopeKind: "SCHEDULE", candidateId: 7, registrationId: 8 })).not.toEqual(
      candidateClaimOwnerKey({ scopeKind: "SYSTEM", candidateId: 7 }),
    );
    expect(() => candidateClaimOwnerKey({ scopeKind: "SCHEDULE", candidateId: 7 })).toThrow("registration ID");
    expect(() => candidateSystemScopeKey(0)).toThrow("positive ID");
    expect(pseudonymAdmissionScopeKey(1)).not.toEqual(pseudonymScheduleScopeKey(1));
    expect(defaultPolicyScopeKey(1)).not.toEqual(admissionPolicyScopeKey(1));
  });

  it("rejects control characters in candidate numbers before trimming", () => {
    expect(() => normalizeCandidateNumber("2044\u0000001")).toThrow("control characters");
    expect(() => normalizeCandidateNumber("2044001\n")).toThrow("control characters");
    expect(normalizeCandidateNumber(" ２０４４００１ ")).toBe("2044001");
    expect(() => normalizeCandidateNumber("  ")).toThrow("must not be blank");
    expect(() => normalizeCandidateNumber("1".repeat(101))).toThrow("100 characters");
  });

  it("stores canonical numeric value and display width independently", () => {
    expect(parseCanonicalPseudonymNumber("００１")).toEqual({ value: 1, displayWidth: 3 });
    expect(displayPseudonymNumber(1, 3)).toBe("001");
    expect(parseCanonicalPseudonymNumber("")).toBeNull();
    expect(parseCanonicalPseudonymNumber(undefined)).toBeNull();
    expect(() => parseCanonicalPseudonymNumber("A01")).toThrow("digits only");
    expect(() => parseCanonicalPseudonymNumber("0")).toThrow("safe range");
    expect(() => parseCanonicalPseudonymNumber("999999999999999999999")).toThrow("safe range");
    expect(() => displayPseudonymNumber(0, 3)).toThrow("positive integer");
    for (const width of [0, 1.5, 101]) expect(() => displayPseudonymNumber(1, width)).toThrow("between 1 and 100");
  });

  it("normalizes optional source codes and length-prefixes mixed source rows", () => {
    expect(normalizeSourceCode("  a-01 ")).toBe("A-01");
    expect(normalizeSourceCode(null)).toBeNull();
    expect(sourceRowHash("candidate", [true, 7, "value", null])).toHaveLength(32);
    expect(() => identityDigest("", ["value"])).toThrow("Identity namespace");
  });
});
