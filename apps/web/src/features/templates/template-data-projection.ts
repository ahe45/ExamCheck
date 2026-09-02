export class TemplateDataProjectionError extends Error {
  constructor(readonly tagKey: string) {
    super(`양식 데이터 태그 값을 찾을 수 없습니다: ${tagKey}`);
    this.name = "TemplateDataProjectionError";
  }
}

/**
 * Target identity 모델의 명칭을 기존 양식 data tag 계약으로 투영한다.
 *
 * 객체의 key 존재 여부와 실제 값의 유무를 구분한다. 빈 문자열과 0은 유효한 출력값이지만,
 * key가 없거나 null/undefined인 값은 조용히 빈칸으로 바꾸지 않고 오류로 중단한다.
 */
export const legacyTemplateDataTagAliases = Object.freeze({
  "candidate.examNo": ["candidate.examineeNo", "candidate.number"],
  "candidate.temporaryNo": ["assignment.pseudonymNumber", "candidate.pseudonymNumber"],
  "candidate.preassignedNo": ["registration.preassignedNumber"],
  "candidate.examName": ["examCycle.displayName"],
  "candidate.examDate": ["operationSlot.examDate"],
  "candidate.examStartTime": ["operationSlot.startTime"],
  "candidate.examEndTime": ["operationSlot.endTime"],
  "candidate.admissionYear": ["examCycle.academicYear"],
  "candidate.admissionTypeCode": ["admission.code"],
  "candidate.admissionTypeName": ["admission.name"],
  "candidate.departmentCode": ["scheduleSegment.unitCode"],
  "candidate.departmentName": ["scheduleSegment.unitName"],
  "candidate.majorCode": ["scheduleSegment.majorCode"],
  "candidate.majorName": ["scheduleSegment.majorName"],
  "candidate.periodCode": ["operationSlot.periodCode"],
  "candidate.periodName": ["operationSlot.periodName"],
  "candidate.groupName": ["registration.groupName"],
  "candidate.buildingCode": ["scheduleSegment.buildingCode"],
  "candidate.buildingName": ["scheduleSegment.buildingName"],
  "candidate.roomCode": ["scheduleSegment.roomCode"],
  "candidate.roomName": ["scheduleSegment.roomName"],
  "candidate.opt1": ["registration.opt1"],
  "candidate.opt2": ["registration.opt2"],
  "candidate.opt3": ["registration.opt3"],
} satisfies Record<string, readonly string[]>);

export function resolveTemplateDataTagValue(key: string, values: Readonly<Record<string, unknown>>): unknown {
  const normalizedKey = normalizeTemplateDataTagKey(key);
  const directValue = ownDefinedValue(values, normalizedKey);
  if (directValue.found) return directValue.value;

  const aliases = legacyTemplateDataTagAliases[normalizedKey as keyof typeof legacyTemplateDataTagAliases] ?? [];
  for (const alias of aliases) {
    const aliasValue = ownDefinedValue(values, alias);
    if (aliasValue.found) return aliasValue.value;
  }

  throw new TemplateDataProjectionError(normalizedKey);
}

export function normalizeTemplateDataTagKey(key: string): string {
  return String(key || "")
    .trim()
    .replace(/^@\{\s*/, "")
    .replace(/^\{\{\s*/, "")
    .replace(/\s*\}\}$/, "")
    .replace(/\s*\}$/, "")
    .replace(/^#/, "")
    .trim();
}

function ownDefinedValue(
  values: Readonly<Record<string, unknown>>,
  key: string,
): { found: true; value: unknown } | { found: false } {
  if (!Object.prototype.hasOwnProperty.call(values, key)) return { found: false };
  const value = values[key];
  return value === null || value === undefined ? { found: false } : { found: true, value };
}
