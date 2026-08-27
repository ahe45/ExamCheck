import { describe, expect, it } from "vitest";
import {
  createIdentityDryRunReport,
  identityCodeFields,
  type IdentityCodeField,
  type IdentityDryRunSource,
} from "./identity-dry-run.js";
import { normalizeExamineeNumber, normalizeIdentityText } from "./identity-normalization.js";

describe("identity transition dry-run", () => {
  it("normalizes NFKC and surrounding whitespace while preserving leading zeroes", () => {
    expect(normalizeIdentityText("  ＡＢＣ  ")).toBe("ABC");
    expect(normalizeExamineeNumber(" ００１ ")).toBe("001");
    expect(normalizeExamineeNumber("001")).not.toBe(normalizeExamineeNumber("1"));
  });

  it("classifies exact, unmapped and ambiguous mappings without returning identity values", () => {
    const report = createIdentityDryRunReport({
      sources: [
        source(11, { examineeNo: " ００１ ", name: " 홍길동 " }),
        source(12, { examineeNo: "002", name: "김하나" }),
        source(13, { examineeNo: "003", name: "이둘" }),
      ],
      targets: [
        target(101, "001", "홍길동", "2000-01-01"),
        target(103, "003", "이둘", "2000-01-01"),
        target(104, "003", "이둘", "2000-01-01"),
      ],
    });

    expect(report.mapping).toEqual({
      exactCount: 1,
      unmappedCount: 1,
      ambiguousCount: 1,
      classifications: [
        { sourceId: 11, status: "EXACT", candidateCount: 1 },
        { sourceId: 12, status: "UNMAPPED", candidateCount: 0 },
        { sourceId: 13, status: "AMBIGUOUS", candidateCount: 2 },
      ],
    });
    expect(report.normalizationCollisionGroups.examineeNumber).toBe(1);
    expect(report.normalizationCollisionGroups.name).toBe(1);
    expect(JSON.stringify(report)).not.toContain("홍길동");
    expect(JSON.stringify(report)).not.toContain("2000-01-01");
    expect(JSON.stringify(report)).not.toContain("００１");
  });

  it("counts conflicting personal identities for one normalized examinee number", () => {
    const report = createIdentityDryRunReport({
      sources: [
        source(21, { examineeNo: "010", name: "같은사람", birthDate: "2001-02-03" }),
        source(22, { examineeNo: " ０１０ ", name: "다른사람", birthDate: "2001-02-03" }),
        source(23, { examineeNo: "10", name: "선행영별도", birthDate: "2001-02-03" }),
      ],
      targets: [],
    });

    expect(report.identity).toEqual({
      conflictingExamineeNumberGroupCount: 1,
      conflictingSourceRowCount: 2,
    });
    expect(report.normalizationCollisionGroups.examineeNumber).toBe(1);
  });

  it("reports blank codes, range overlaps and ALL/ASSIGNED permission anomalies as aggregates", () => {
    const completeCodes = codes();
    const report = createIdentityDryRunReport({
      sources: [
        source(31, { codes: completeCodes }),
        source(32, {
          codes: { ...completeCodes, admission: "", building: "  ", period: "Ｐ１" },
        }),
        source(33, { codes: { ...completeCodes, period: "P1" } }),
      ],
      targets: [],
      ranges: [
        { rangeId: 1, scopeId: 1, startValue: 1001, endValue: 1003 },
        { rangeId: 2, scopeId: 1, startValue: 1003, endValue: 1005 },
        { rangeId: 3, scopeId: 2, startValue: 1001, endValue: 1002 },
        { rangeId: 4, scopeId: 1, startValue: 5, endValue: 4 },
      ],
      rangeScopes: [
        { scopeId: 1, targetCount: 6 },
        { scopeId: 2, targetCount: 2 },
      ],
      permissions: [
        { accountId: 1, mode: "ALL", admissionIds: [] },
        { accountId: 2, mode: "ASSIGNED", admissionIds: [10, 11, 11] },
        { accountId: 3, mode: "ASSIGNED", admissionIds: [] },
        { accountId: 4, mode: "ALL", admissionIds: [10] },
      ],
    });

    expect(report.blankCodes.sourceRowCount).toBe(1);
    expect(report.blankCodes.byField.admission).toBe(1);
    expect(report.blankCodes.byField.building).toBe(1);
    expect(report.normalizationCollisionGroups.code).toBe(1);
    expect(report.ranges).toEqual({
      totalCount: 4,
      invalidCount: 1,
      overlapPairCount: 1,
      capacitySum: 8,
      unionCapacity: 7,
      targetCount: 8,
      deficientScopeCount: 1,
      capacityDeficit: 1,
    });
    expect(report.permissions).toEqual({
      accountCount: 4,
      allCount: 2,
      assignedCount: 2,
      assignedWithoutAdmissionCount: 1,
      allWithAssignmentsCount: 1,
      duplicateAssignmentCount: 1,
    });
  });

  it("never serializes raw names, birth dates or examinee numbers into the dry-run report", () => {
    const privateValues = {
      examineeNo: "PRIVATE-EXAMINEE-0007",
      name: "비공개수험생성명",
      birthDate: "1999-12-31",
    };
    const report = createIdentityDryRunReport({
      sources: [source(41, privateValues)],
      targets: [target(401, privateValues.examineeNo, privateValues.name, privateValues.birthDate)],
    });
    const serialized = JSON.stringify(report);

    for (const value of Object.values(privateValues)) expect(serialized).not.toContain(value);
    expect(serialized).toContain('"status":"EXACT"');
  });
});

function source(
  sourceId: number,
  overrides: Partial<Omit<IdentityDryRunSource, "sourceId">> = {},
): IdentityDryRunSource {
  return {
    sourceId,
    examineeNo: `E-${sourceId}`,
    name: `수험생-${sourceId}`,
    birthDate: "2000-01-01",
    codes: codes(),
    ...overrides,
  };
}

function target(targetId: number, examineeNo: string, name: string, birthDate: string) {
  return { targetId, examineeNo, name, birthDate };
}

function codes(overrides: Partial<Record<IdentityCodeField, string>> = {}) {
  return Object.fromEntries(
    identityCodeFields.map((field) => [field, `${field}-code`]).concat(Object.entries(overrides)),
  );
}
