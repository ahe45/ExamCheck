import { describe, expect, it } from "vitest";
import { validateIdentityRanges, type IdentityRangeValidationInput } from "./identity-range-validation.js";

describe("identity range validation", () => {
  it("validates ADMISSION ranges as one admission-wide union", () => {
    expect(
      validateIdentityRanges({
        policyScope: "ADMISSION",
        targetCount: 7,
        slots: [
          { slotId: 1, segments: [{ segmentId: 11, start: 1, end: 3 }] },
          { slotId: 2, segments: [{ segmentId: 12, start: 3, end: 5 }] },
        ],
      }),
    ).toEqual({
      overlapPairCount: 1,
      rawCapacitySum: 6,
      unionCapacity: 5,
      deficit: 2,
      blockingIssueCodes: ["ADMISSION_RANGE_OVERLAP", "ADMISSION_RANGE_CAPACITY_DEFICIT"],
    });
  });

  it("validates SCHEDULE ranges inside each slot and adds the slot results", () => {
    expect(
      validateIdentityRanges({
        policyScope: "SCHEDULE",
        targetCount: 7,
        slots: [
          {
            slotId: 1,
            targetCount: 5,
            segments: [
              { segmentId: 11, start: 1, end: 3 },
              { segmentId: 12, start: 3, end: 4 },
            ],
          },
          {
            slotId: 2,
            targetCount: 2,
            segments: [{ segmentId: 21, start: 1, end: 2 }],
          },
        ],
      }),
    ).toEqual({
      overlapPairCount: 1,
      rawCapacitySum: 7,
      unionCapacity: 6,
      deficit: 1,
      blockingIssueCodes: ["SCHEDULE_SLOT_RANGE_OVERLAP", "SCHEDULE_SLOT_RANGE_CAPACITY_DEFICIT"],
    });
  });

  it("allows the same values in different SCHEDULE slots", () => {
    expect(
      validateIdentityRanges({
        policyScope: "SCHEDULE",
        targetCount: 4,
        slots: [
          { slotId: 1, targetCount: 2, segments: [{ segmentId: 11, start: 1, end: 2 }] },
          { slotId: 2, targetCount: 2, segments: [{ segmentId: 21, start: 1, end: 2 }] },
        ],
      }),
    ).toEqual({
      overlapPairCount: 0,
      rawCapacitySum: 4,
      unionCapacity: 4,
      deficit: 0,
      blockingIssueCodes: [],
    });
  });

  it("does not count adjacent ranges as overlaps", () => {
    expect(
      validateIdentityRanges({
        policyScope: "ADMISSION",
        targetCount: 4,
        slots: [
          {
            slotId: 1,
            segments: [
              { segmentId: 11, start: 1, end: 2 },
              { segmentId: 12, start: 3, end: 4 },
            ],
          },
        ],
      }),
    ).toEqual({
      overlapPairCount: 0,
      rawCapacitySum: 4,
      unionCapacity: 4,
      deficit: 0,
      blockingIssueCodes: [],
    });
  });

  it("reports overlap and capacity issues independently", () => {
    const overlapOnly = validateIdentityRanges({
      policyScope: "ADMISSION",
      targetCount: 4,
      slots: [
        {
          slotId: 1,
          segments: [
            { segmentId: 11, start: 1, end: 3 },
            { segmentId: 12, start: 2, end: 4 },
          ],
        },
      ],
    });
    const deficitOnly = validateIdentityRanges({
      policyScope: "ADMISSION",
      targetCount: 5,
      slots: [{ slotId: 1, segments: [{ segmentId: 11, start: 1, end: 4 }] }],
    });

    expect(overlapOnly.blockingIssueCodes).toEqual(["ADMISSION_RANGE_OVERLAP"]);
    expect(overlapOnly.deficit).toBe(0);
    expect(deficitOnly.blockingIssueCodes).toEqual(["ADMISSION_RANGE_CAPACITY_DEFICIT"]);
    expect(deficitOnly.overlapPairCount).toBe(0);
  });

  it.each([
    {
      name: "zero range bound",
      input: admissionInput({ start: 0 }),
      error: "Range bounds must be positive safe integers.",
    },
    {
      name: "fractional range bound",
      input: admissionInput({ end: 2.5 }),
      error: "Range bounds must be positive safe integers.",
    },
    {
      name: "unsafe range bound",
      input: admissionInput({ end: Number.MAX_SAFE_INTEGER + 1 }),
      error: "Range bounds must be positive safe integers.",
    },
    {
      name: "reversed range",
      input: admissionInput({ start: 3, end: 2 }),
      error: "Range start must not exceed range end.",
    },
    {
      name: "negative target count",
      input: { ...admissionInput(), targetCount: -1 },
      error: "Target count must be a non-negative safe integer.",
    },
    {
      name: "invalid slot ID",
      input: { ...admissionInput(), slots: [{ slotId: 0, segments: [{ segmentId: 11, start: 1, end: 2 }] }] },
      error: "Slot IDs must be positive safe integers.",
    },
    {
      name: "invalid segment ID",
      input: { ...admissionInput(), slots: [{ slotId: 1, segments: [{ segmentId: 0, start: 1, end: 2 }] }] },
      error: "Segment IDs must be positive safe integers.",
    },
  ])("rejects $name without returning input values", ({ input, error }) => {
    expect(() => validateIdentityRanges(input)).toThrow(error);
  });

  it("rejects duplicate internal IDs and inconsistent schedule targets", () => {
    expect(() =>
      validateIdentityRanges({
        policyScope: "ADMISSION",
        targetCount: 2,
        slots: [
          { slotId: 1, segments: [{ segmentId: 11, start: 1, end: 1 }] },
          { slotId: 1, segments: [{ segmentId: 12, start: 2, end: 2 }] },
        ],
      }),
    ).toThrow("Slot IDs must be unique.");
    expect(() =>
      validateIdentityRanges({
        policyScope: "ADMISSION",
        targetCount: 2,
        slots: [
          {
            slotId: 1,
            segments: [
              { segmentId: 11, start: 1, end: 1 },
              { segmentId: 11, start: 2, end: 2 },
            ],
          },
        ],
      }),
    ).toThrow("Segment IDs must be unique.");
    expect(() =>
      validateIdentityRanges({
        policyScope: "SCHEDULE",
        targetCount: 3,
        slots: [{ slotId: 1, targetCount: 2, segments: [{ segmentId: 11, start: 1, end: 2 }] }],
      }),
    ).toThrow("Schedule target count must equal the sum of slot target counts.");
  });

  it("fails closed when aggregate capacity exceeds the safe integer range", () => {
    expect(() =>
      validateIdentityRanges({
        policyScope: "ADMISSION",
        targetCount: 0,
        slots: [
          { slotId: 1, segments: [{ segmentId: 11, start: 1, end: Number.MAX_SAFE_INTEGER }] },
          { slotId: 2, segments: [{ segmentId: 21, start: 1, end: Number.MAX_SAFE_INTEGER }] },
        ],
      }),
    ).toThrow("Range aggregate exceeds the safe integer limit.");
  });

  it("returns aggregates and issue codes only", () => {
    const result = validateIdentityRanges({
      policyScope: "ADMISSION",
      targetCount: 3,
      slots: [{ slotId: 987_654, segments: [{ segmentId: 123_456, start: 101, end: 102 }] }],
    });

    expect(Object.keys(result)).toEqual([
      "overlapPairCount",
      "rawCapacitySum",
      "unionCapacity",
      "deficit",
      "blockingIssueCodes",
    ]);
    expect(result).toEqual({
      overlapPairCount: 0,
      rawCapacitySum: 2,
      unionCapacity: 2,
      deficit: 1,
      blockingIssueCodes: ["ADMISSION_RANGE_CAPACITY_DEFICIT"],
    });
  });
});

function admissionInput(
  overrides: Partial<{ start: number; end: number }> = {},
): Extract<IdentityRangeValidationInput, { policyScope: "ADMISSION" }> {
  return {
    policyScope: "ADMISSION",
    targetCount: 2,
    slots: [
      {
        slotId: 1,
        segments: [{ segmentId: 11, start: 1, end: 2, ...overrides }],
      },
    ],
  };
}
