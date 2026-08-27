import {
  canonicalPersonalIdentity,
  normalizeExamineeNumber,
  normalizeIdentityText,
  type PersonalIdentityInput,
} from "./identity-normalization.js";

export const IDENTITY_TRANSITION_REPORT_SCHEMA_VERSION = 1 as const;

export const identityCodeFields = ["examCycle", "admission", "period", "unit", "major", "building", "room"] as const;

export type IdentityCodeField = (typeof identityCodeFields)[number];
export type IdentityMappingStatus = "EXACT" | "UNMAPPED" | "AMBIGUOUS";
export type AdmissionScopeMode = "ALL" | "ASSIGNED";

export interface IdentityDryRunSource extends PersonalIdentityInput {
  sourceId: number;
  codes: Readonly<Partial<Record<IdentityCodeField, string | null>>>;
}

export interface IdentityDryRunTarget extends PersonalIdentityInput {
  targetId: number;
}

export interface IdentityRangeInput {
  rangeId: number;
  scopeId: number;
  startValue: number;
  endValue: number;
}

export interface IdentityRangeScopeInput {
  scopeId: number;
  targetCount: number;
}

export interface IdentityPermissionInput {
  accountId: number;
  mode: AdmissionScopeMode;
  admissionIds: readonly number[];
}

export interface IdentityDryRunInput {
  sources: readonly IdentityDryRunSource[];
  targets: readonly IdentityDryRunTarget[];
  ranges?: readonly IdentityRangeInput[];
  rangeScopes?: readonly IdentityRangeScopeInput[];
  permissions?: readonly IdentityPermissionInput[];
}

export interface IdentityMappingClassification {
  sourceId: number;
  status: IdentityMappingStatus;
  candidateCount: number;
}

export interface IdentityDryRunReport {
  schemaVersion: typeof IDENTITY_TRANSITION_REPORT_SCHEMA_VERSION;
  source: {
    totalCount: number;
    minimumId: number | null;
    maximumId: number | null;
  };
  target: { totalCount: number };
  mapping: {
    exactCount: number;
    unmappedCount: number;
    ambiguousCount: number;
    classifications: readonly IdentityMappingClassification[];
  };
  identity: {
    conflictingExamineeNumberGroupCount: number;
    conflictingSourceRowCount: number;
  };
  normalizationCollisionGroups: {
    examineeNumber: number;
    name: number;
    code: number;
  };
  blankCodes: {
    sourceRowCount: number;
    byField: Readonly<Record<IdentityCodeField, number>>;
  };
  ranges: {
    totalCount: number;
    invalidCount: number;
    overlapPairCount: number;
    capacitySum: number;
    unionCapacity: number;
    targetCount: number;
    deficientScopeCount: number;
    capacityDeficit: number;
  };
  permissions: {
    accountCount: number;
    allCount: number;
    assignedCount: number;
    assignedWithoutAdmissionCount: number;
    allWithAssignmentsCount: number;
    duplicateAssignmentCount: number;
  };
}

export function createIdentityDryRunReport(input: IdentityDryRunInput): IdentityDryRunReport {
  assertInternalIds(input);

  const targetsByIdentity = groupTargetIdsByIdentity(input.targets);
  const classifications = input.sources
    .map((source): IdentityMappingClassification => {
      const candidateCount = targetsByIdentity.get(canonicalPersonalIdentity(source))?.length ?? 0;
      return {
        sourceId: source.sourceId,
        status: candidateCount === 1 ? "EXACT" : candidateCount === 0 ? "UNMAPPED" : "AMBIGUOUS",
        candidateCount,
      };
    })
    .sort((left, right) => left.sourceId - right.sourceId);
  const conflictingNumbers = findConflictingExamineeNumbers([...input.sources, ...input.targets]);
  const codeAnalysis = analyzeCodes(input.sources);
  const rangeAnalysis = analyzeRanges(input.ranges ?? [], input.rangeScopes ?? []);
  const permissionAnalysis = analyzePermissions(input.permissions ?? []);
  const sourceIdRange = findInternalIdRange(input.sources.map((source) => source.sourceId));

  return {
    schemaVersion: IDENTITY_TRANSITION_REPORT_SCHEMA_VERSION,
    source: {
      totalCount: input.sources.length,
      minimumId: sourceIdRange.minimum,
      maximumId: sourceIdRange.maximum,
    },
    target: { totalCount: input.targets.length },
    mapping: {
      exactCount: classifications.filter((item) => item.status === "EXACT").length,
      unmappedCount: classifications.filter((item) => item.status === "UNMAPPED").length,
      ambiguousCount: classifications.filter((item) => item.status === "AMBIGUOUS").length,
      classifications,
    },
    identity: {
      conflictingExamineeNumberGroupCount: conflictingNumbers.size,
      conflictingSourceRowCount: input.sources.filter((source) =>
        conflictingNumbers.has(normalizeExamineeNumber(source.examineeNo)),
      ).length,
    },
    normalizationCollisionGroups: {
      examineeNumber: countNormalizationCollisionGroups(
        [...input.sources, ...input.targets].map((item) => item.examineeNo),
      ),
      name: countNormalizationCollisionGroups([...input.sources, ...input.targets].map((item) => item.name)),
      code: codeAnalysis.normalizationCollisionGroups,
    },
    blankCodes: {
      sourceRowCount: codeAnalysis.sourceRowCount,
      byField: codeAnalysis.byField,
    },
    ranges: rangeAnalysis,
    permissions: permissionAnalysis,
  };
}

function groupTargetIdsByIdentity(targets: readonly IdentityDryRunTarget[]): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const target of targets) {
    const key = canonicalPersonalIdentity(target);
    const ids = result.get(key) ?? [];
    ids.push(target.targetId);
    result.set(key, ids);
  }
  return result;
}

function findConflictingExamineeNumbers(rows: readonly PersonalIdentityInput[]): Set<string> {
  const identitiesByNumber = new Map<string, Set<string>>();
  for (const row of rows) {
    const examineeNumber = normalizeExamineeNumber(row.examineeNo);
    if (!examineeNumber) continue;
    const personalIdentity = JSON.stringify([normalizeIdentityText(row.name), normalizeIdentityText(row.birthDate)]);
    const identities = identitiesByNumber.get(examineeNumber) ?? new Set<string>();
    identities.add(personalIdentity);
    identitiesByNumber.set(examineeNumber, identities);
  }
  return new Set(
    [...identitiesByNumber.entries()].filter(([, identities]) => identities.size > 1).map(([number]) => number),
  );
}

function countNormalizationCollisionGroups(values: readonly string[]): number {
  const rawValuesByCanonical = new Map<string, Set<string>>();
  for (const rawValue of values) {
    const canonical = normalizeIdentityText(rawValue);
    if (!canonical) continue;
    const rawValues = rawValuesByCanonical.get(canonical) ?? new Set<string>();
    rawValues.add(rawValue);
    rawValuesByCanonical.set(canonical, rawValues);
  }
  return [...rawValuesByCanonical.values()].filter((rawValues) => rawValues.size > 1).length;
}

function analyzeCodes(sources: readonly IdentityDryRunSource[]) {
  const byField = Object.fromEntries(identityCodeFields.map((field) => [field, 0])) as Record<
    IdentityCodeField,
    number
  >;
  let sourceRowCount = 0;
  let normalizationCollisionGroups = 0;

  for (const field of identityCodeFields) {
    const values: string[] = [];
    for (const source of sources) {
      const value = source.codes[field] ?? "";
      if (!normalizeIdentityText(value)) byField[field] += 1;
      else values.push(value);
    }
    normalizationCollisionGroups += countNormalizationCollisionGroups(values);
  }

  for (const source of sources) {
    if (identityCodeFields.some((field) => !normalizeIdentityText(source.codes[field] ?? ""))) {
      sourceRowCount += 1;
    }
  }
  return { byField, sourceRowCount, normalizationCollisionGroups };
}

function analyzeRanges(
  ranges: readonly IdentityRangeInput[],
  rangeScopes: readonly IdentityRangeScopeInput[],
): IdentityDryRunReport["ranges"] {
  const validRangesByScope = new Map<number, Array<{ start: number; end: number }>>();
  let invalidCount = 0;
  let capacitySum = 0;

  for (const range of ranges) {
    if (
      !isValidPositiveInteger(range.startValue) ||
      !isValidPositiveInteger(range.endValue) ||
      range.endValue < range.startValue
    ) {
      invalidCount += 1;
      continue;
    }
    const values = validRangesByScope.get(range.scopeId) ?? [];
    values.push({ start: range.startValue, end: range.endValue });
    validRangesByScope.set(range.scopeId, values);
    capacitySum = addSafe(capacitySum, range.endValue - range.startValue + 1);
  }

  let overlapPairCount = 0;
  let unionCapacity = 0;
  const unionCapacityByScope = new Map<number, number>();
  for (const [scopeId, values] of validRangesByScope) {
    for (let left = 0; left < values.length; left += 1) {
      for (let right = left + 1; right < values.length; right += 1) {
        if (values[left]!.start <= values[right]!.end && values[right]!.start <= values[left]!.end) {
          overlapPairCount += 1;
        }
      }
    }
    const scopeCapacity = calculateUnionCapacity(values);
    unionCapacityByScope.set(scopeId, scopeCapacity);
    unionCapacity = addSafe(unionCapacity, scopeCapacity);
  }

  let targetCount = 0;
  let deficientScopeCount = 0;
  let capacityDeficit = 0;
  for (const scope of rangeScopes) {
    if (!Number.isSafeInteger(scope.targetCount) || scope.targetCount < 0) {
      throw new TypeError("Range target counts must be non-negative safe integers.");
    }
    targetCount = addSafe(targetCount, scope.targetCount);
    const deficit = Math.max(0, scope.targetCount - (unionCapacityByScope.get(scope.scopeId) ?? 0));
    if (deficit > 0) deficientScopeCount += 1;
    capacityDeficit = addSafe(capacityDeficit, deficit);
  }

  return {
    totalCount: ranges.length,
    invalidCount,
    overlapPairCount,
    capacitySum,
    unionCapacity,
    targetCount,
    deficientScopeCount,
    capacityDeficit,
  };
}

function calculateUnionCapacity(values: readonly { start: number; end: number }[]): number {
  const sorted = [...values].sort((left, right) => left.start - right.start || left.end - right.end);
  let total = 0;
  let currentStart: number | null = null;
  let currentEnd: number | null = null;
  for (const value of sorted) {
    if (currentStart === null || currentEnd === null) {
      currentStart = value.start;
      currentEnd = value.end;
    } else if (value.start <= currentEnd + 1) {
      currentEnd = Math.max(currentEnd, value.end);
    } else {
      total = addSafe(total, currentEnd - currentStart + 1);
      currentStart = value.start;
      currentEnd = value.end;
    }
  }
  return currentStart === null || currentEnd === null ? total : addSafe(total, currentEnd - currentStart + 1);
}

function analyzePermissions(permissions: readonly IdentityPermissionInput[]): IdentityDryRunReport["permissions"] {
  let allCount = 0;
  let assignedCount = 0;
  let assignedWithoutAdmissionCount = 0;
  let allWithAssignmentsCount = 0;
  let duplicateAssignmentCount = 0;

  for (const permission of permissions) {
    const uniqueAssignments = new Set(permission.admissionIds);
    duplicateAssignmentCount += permission.admissionIds.length - uniqueAssignments.size;
    if (permission.mode === "ALL") {
      allCount += 1;
      if (permission.admissionIds.length > 0) allWithAssignmentsCount += 1;
    } else {
      assignedCount += 1;
      if (permission.admissionIds.length === 0) assignedWithoutAdmissionCount += 1;
    }
  }

  return {
    accountCount: permissions.length,
    allCount,
    assignedCount,
    assignedWithoutAdmissionCount,
    allWithAssignmentsCount,
    duplicateAssignmentCount,
  };
}

function assertInternalIds(input: IdentityDryRunInput): void {
  const ids = [
    ...input.sources.map((item) => item.sourceId),
    ...input.targets.map((item) => item.targetId),
    ...(input.ranges ?? []).flatMap((item) => [item.rangeId, item.scopeId]),
    ...(input.rangeScopes ?? []).map((item) => item.scopeId),
    ...(input.permissions ?? []).flatMap((item) => [item.accountId, ...item.admissionIds]),
  ];
  if (ids.some((value) => !isValidPositiveInteger(value))) {
    throw new TypeError("Identity transition references must be positive safe integer internal IDs.");
  }
}

function isValidPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function addSafe(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError("Identity transition aggregate exceeds safe integer range.");
  return result;
}

function findInternalIdRange(values: readonly number[]): { minimum: number | null; maximum: number | null } {
  let minimum: number | null = null;
  let maximum: number | null = null;
  for (const value of values) {
    minimum = minimum === null ? value : Math.min(minimum, value);
    maximum = maximum === null ? value : Math.max(maximum, value);
  }
  return { minimum, maximum };
}
