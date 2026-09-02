export type IdentityRangePolicyScope = "ADMISSION" | "SCHEDULE";

export type IdentityRangeBlockingIssueCode =
  | "ADMISSION_RANGE_OVERLAP"
  | "ADMISSION_RANGE_CAPACITY_DEFICIT"
  | "SCHEDULE_SLOT_RANGE_OVERLAP"
  | "SCHEDULE_SLOT_RANGE_CAPACITY_DEFICIT";

export interface IdentitySegmentRangeInput {
  segmentId: number;
  start: number;
  end: number;
}

export interface IdentityAdmissionRangeSlotInput {
  slotId: number;
  segments: readonly IdentitySegmentRangeInput[];
}

export interface IdentityScheduleRangeSlotInput extends IdentityAdmissionRangeSlotInput {
  targetCount: number;
}

export type IdentityRangeValidationInput =
  | {
      policyScope: "ADMISSION";
      targetCount: number;
      slots: readonly IdentityAdmissionRangeSlotInput[];
    }
  | {
      policyScope: "SCHEDULE";
      targetCount: number;
      slots: readonly IdentityScheduleRangeSlotInput[];
    };

export interface IdentityRangeValidationResult {
  overlapPairCount: number;
  rawCapacitySum: number;
  unionCapacity: number;
  deficit: number;
  blockingIssueCodes: readonly IdentityRangeBlockingIssueCode[];
}

interface NumericRange {
  start: number;
  end: number;
}

/**
 * Validates target-model pseudonym ranges without accepting or returning candidate identity data.
 * ADMISSION treats every segment range as one scope. SCHEDULE validates each slot independently.
 */
export function validateIdentityRanges(input: IdentityRangeValidationInput): IdentityRangeValidationResult {
  assertNonNegativeSafeInteger(input.targetCount, "Target count must be a non-negative safe integer.");
  assertUniquePositiveInternalIds(input.slots);

  let rawCapacitySum = 0;
  for (const slot of input.slots) {
    for (const segment of slot.segments) {
      assertRange(segment);
      rawCapacitySum = addSafe(rawCapacitySum, rangeCapacity(segment));
    }
  }

  if (input.policyScope === "ADMISSION") {
    const ranges = input.slots.flatMap((slot) => slot.segments);
    const overlapPairCount = countOverlapPairs(ranges);
    const unionCapacity = calculateUnionCapacity(ranges);
    const deficit = Math.max(0, input.targetCount - unionCapacity);
    return {
      overlapPairCount,
      rawCapacitySum,
      unionCapacity,
      deficit,
      blockingIssueCodes: admissionIssueCodes(overlapPairCount, deficit),
    };
  }

  let scheduledTargetCount = 0;
  let overlapPairCount = 0;
  let unionCapacity = 0;
  let deficit = 0;
  for (const slot of input.slots) {
    assertNonNegativeSafeInteger(slot.targetCount, "Slot target counts must be non-negative safe integers.");
    scheduledTargetCount = addSafe(scheduledTargetCount, slot.targetCount);
    const slotOverlapPairCount = countOverlapPairs(slot.segments);
    const slotUnionCapacity = calculateUnionCapacity(slot.segments);
    overlapPairCount = addSafe(overlapPairCount, slotOverlapPairCount);
    unionCapacity = addSafe(unionCapacity, slotUnionCapacity);
    deficit = addSafe(deficit, Math.max(0, slot.targetCount - slotUnionCapacity));
  }
  if (scheduledTargetCount !== input.targetCount) {
    throw new TypeError("Schedule target count must equal the sum of slot target counts.");
  }

  return {
    overlapPairCount,
    rawCapacitySum,
    unionCapacity,
    deficit,
    blockingIssueCodes: scheduleIssueCodes(overlapPairCount, deficit),
  };
}

function assertUniquePositiveInternalIds(slots: IdentityRangeValidationInput["slots"]): void {
  const slotIds = new Set<number>();
  const segmentIds = new Set<number>();
  for (const slot of slots) {
    assertPositiveSafeInteger(slot.slotId, "Slot IDs must be positive safe integers.");
    if (slotIds.has(slot.slotId)) throw new TypeError("Slot IDs must be unique.");
    slotIds.add(slot.slotId);
    for (const segment of slot.segments) {
      assertPositiveSafeInteger(segment.segmentId, "Segment IDs must be positive safe integers.");
      if (segmentIds.has(segment.segmentId)) throw new TypeError("Segment IDs must be unique.");
      segmentIds.add(segment.segmentId);
    }
  }
}

function assertRange(range: IdentitySegmentRangeInput): void {
  assertPositiveSafeInteger(range.start, "Range bounds must be positive safe integers.");
  assertPositiveSafeInteger(range.end, "Range bounds must be positive safe integers.");
  if (range.start > range.end) throw new RangeError("Range start must not exceed range end.");
}

function rangeCapacity(range: NumericRange): number {
  return range.end - range.start + 1;
}

function countOverlapPairs(ranges: readonly NumericRange[]): number {
  let count = 0;
  for (let left = 0; left < ranges.length; left += 1) {
    for (let right = left + 1; right < ranges.length; right += 1) {
      const leftRange = ranges[left]!;
      const rightRange = ranges[right]!;
      if (leftRange.start <= rightRange.end && rightRange.start <= leftRange.end) {
        count = addSafe(count, 1);
      }
    }
  }
  return count;
}

function calculateUnionCapacity(ranges: readonly NumericRange[]): number {
  const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
  let total = 0;
  let current: NumericRange | null = null;
  for (const range of sorted) {
    if (current === null) {
      current = { ...range };
      continue;
    }
    if (rangesTouchOrOverlap(current, range)) {
      current.end = Math.max(current.end, range.end);
      continue;
    }
    total = addSafe(total, rangeCapacity(current));
    current = { ...range };
  }
  return current === null ? total : addSafe(total, rangeCapacity(current));
}

function rangesTouchOrOverlap(left: NumericRange, right: NumericRange): boolean {
  return right.start <= left.end || (left.end < Number.MAX_SAFE_INTEGER && right.start === left.end + 1);
}

function admissionIssueCodes(overlapPairCount: number, deficit: number): IdentityRangeBlockingIssueCode[] {
  const codes: IdentityRangeBlockingIssueCode[] = [];
  if (overlapPairCount > 0) codes.push("ADMISSION_RANGE_OVERLAP");
  if (deficit > 0) codes.push("ADMISSION_RANGE_CAPACITY_DEFICIT");
  return codes;
}

function scheduleIssueCodes(overlapPairCount: number, deficit: number): IdentityRangeBlockingIssueCode[] {
  const codes: IdentityRangeBlockingIssueCode[] = [];
  if (overlapPairCount > 0) codes.push("SCHEDULE_SLOT_RANGE_OVERLAP");
  if (deficit > 0) codes.push("SCHEDULE_SLOT_RANGE_CAPACITY_DEFICIT");
  return codes;
}

function assertPositiveSafeInteger(value: number, message: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(message);
}

function assertNonNegativeSafeInteger(value: number, message: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(message);
}

function addSafe(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError("Range aggregate exceeds the safe integer limit.");
  return result;
}
