import { isValidRequestId } from "../http/request-context.js";

export interface MutationAuditDetailsByEvent {
  ACCOUNT_CREATED: {
    userId: number;
    loginId: string;
    role: "ADMIN" | "USER";
  };
  ACCOUNT_UPDATED: {
    userId: number;
    loginId: string;
    role: "ADMIN" | "USER";
    passwordChanged: boolean;
  };
  ACCOUNT_DELETED: {
    userId: number;
  };
  CANDIDATE_WORKBOOK_IMPORTED: {
    totalRows: number;
    inserted: number;
    updated: number;
    skipped: number;
    policy: "insert-only" | "insert-update" | "all";
    checksum: string;
  };
  CANDIDATE_PHOTO_ARCHIVE_IMPORTED: {
    totalFiles: number;
    uploaded: number;
    updated: number;
    skipped: number;
    duplicateCount: number;
    policy: "insert-only" | "insert-update" | "all";
    checksum: string;
  };
  SYSTEM_PROFILE_UPDATED: {
    schoolName: string;
    academicYear: number;
    systemName: string;
    examineeNoUniqueness: "SYSTEM" | "SCHEDULE";
    pseudonymNoUniqueness: "ADMISSION" | "SCHEDULE";
  };
  SYSTEM_LOGO_UPDATED: {
    fileName: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
  };
  SYSTEM_LOGO_REMOVED: Record<never, never>;
  DEVELOPER_PASSWORD_CHANGED: {
    developerUserId: number;
  };
  WORKSTATION_CREATED: {
    workstationId: number;
    code: string;
  };
  FORM_TEMPLATE_SAVED: {
    code: string;
    templateId: number;
    active: boolean;
    riskCount: number;
  };
  FORM_TEMPLATE_METADATA_UPDATED: {
    code: string;
    templateId: number;
  };
  FORM_TEMPLATE_AVAILABILITY_UPDATED: {
    code: string;
    templateId: number;
    active: boolean;
  };
  FORM_TEMPLATE_DELETED: {
    code: string;
    templateId: number;
  };
  PSEUDONYM_SETTING_UPDATED: {
    settingId: number;
    version: number;
    assignmentMethod: "DRAW" | "SEQUENTIAL" | "MATCHING" | "PREASSIGNED";
    rangeCount: number;
    autoDrawEnabled: boolean;
    autoDrawDelaySeconds: number;
    printPreassignedLabel: boolean;
    autoAssignAbsenteesOnClose: boolean;
    deleteAbsenteeInfoOnReopen: boolean;
    useCandidatePhotos: boolean;
    enableBulkDraw: boolean;
  };
  PSEUDONYM_OPERATION_CLOSED: {
    operationId: number;
    examDate: string;
    examTime: string;
    periodName: string;
    admissionName: string;
    autoAssignedAbsenteeCount: number;
  };
  PSEUDONYM_OPERATION_REOPENED: {
    operationId: number;
    examDate: string;
    examTime: string;
    periodName: string;
    admissionName: string;
    deletedAbsenteeCount: number;
  };
  PSEUDONYM_ASSIGNED: {
    assignmentId: number;
    candidateRecordId: number;
    mode: "RANDOM" | "SEQUENTIAL" | "MANUAL" | "PREASSIGNED";
  };
  PRINT_JOB_CREATED: {
    jobNo: string;
    copies: number;
  };
  PRINT_JOB_SENT: {
    status: "SENT";
  };
  PRINT_JOB_FAILED: {
    status: "FAILED";
    errorRecorded: true;
  };
  PRINT_JOB_EXPIRED: {
    requestedStatus: "SENT" | "FAILED";
    status: "EXPIRED";
  };
  PRINT_JOB_REISSUED: {
    reissueType: "RETRY" | "REPRINT";
    reasonCode: "CLIENT_SEND_RETRY" | "PRINTER_RECOVERY" | "LABEL_DAMAGED" | "PRINT_QUALITY_ISSUE" | "OPERATOR_REQUEST";
  };
}

export type MutationAuditEventType = keyof MutationAuditDetailsByEvent;

interface MutationAuditEnvelope {
  actorUserId: number | null;
  requestId?: string | null;
}

type PrintAuditEventType = Extract<MutationAuditEventType, `PRINT_JOB_${string}`>;

type MutationAuditCorrelation<EventType extends MutationAuditEventType> = EventType extends "WORKSTATION_CREATED"
  ? { workstationId: number; printJobId?: never }
  : EventType extends PrintAuditEventType
    ? { workstationId: number; printJobId: string }
    : { workstationId?: never; printJobId?: never };

export type MutationAuditRecord = {
  [EventType in MutationAuditEventType]: MutationAuditEnvelope &
    MutationAuditCorrelation<EventType> & {
      eventType: EventType;
      details: Readonly<MutationAuditDetailsByEvent[EventType]>;
    };
}[MutationAuditEventType];

export interface NormalizedMutationAuditRecord {
  eventType: MutationAuditEventType;
  actorUserId: number | null;
  workstationId: number | null;
  printJobId: string | null;
  requestId: string | null;
  details: Readonly<Record<string, boolean | number | string>>;
}

export class MutationAuditContractError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "MutationAuditContractError";
  }
}

type FieldRule = (value: unknown) => boolean;

interface EventContract {
  readonly fields: Readonly<Record<string, FieldRule>>;
  readonly correlation: EventCorrelationPolicy;
  readonly validateDetails?: (details: Readonly<Record<string, boolean | number | string>>) => boolean;
  readonly validateRecord?: (
    details: Readonly<Record<string, boolean | number | string>>,
    correlation: Readonly<{ workstationId: number | null; printJobId: string | null }>,
  ) => boolean;
}

type CorrelationPolicy = "required" | "forbidden";
interface EventCorrelationPolicy {
  readonly workstationId: CorrelationPolicy;
  readonly printJobId: CorrelationPolicy;
}

const positiveInteger = integer({ min: 1 });
const nonNegativeInteger = integer({ min: 0 });
const identifier = string({ min: 1, max: 200 });
const shortIdentifier = string({ min: 1, max: 100 });
const checksum = string({ pattern: /^[0-9a-f]{64}$/i });
const date: FieldRule = (value) => typeof value === "string" && isCalendarDate(value);
const time = string({ pattern: /^(?:[01]\d|2[0-3]):[0-5]\d$/ });
const booleanValue: FieldRule = (value) => typeof value === "boolean";
const safeFileName: FieldRule = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 255 &&
  !value.includes("/") &&
  !value.includes("\\") &&
  [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 32 && codePoint !== 127;
  });

const EVENT_CONTRACTS = {
  ACCOUNT_CREATED: fields({
    userId: positiveInteger,
    loginId: string({ min: 1, max: 100 }),
    role: oneOf("ADMIN", "USER"),
  }),
  ACCOUNT_UPDATED: fields({
    userId: positiveInteger,
    loginId: string({ min: 1, max: 100 }),
    role: oneOf("ADMIN", "USER"),
    passwordChanged: booleanValue,
  }),
  ACCOUNT_DELETED: fields({ userId: positiveInteger }),
  CANDIDATE_WORKBOOK_IMPORTED: fields(
    {
      totalRows: nonNegativeInteger,
      inserted: nonNegativeInteger,
      updated: nonNegativeInteger,
      skipped: nonNegativeInteger,
      policy: oneOf("insert-only", "insert-update", "all"),
      checksum,
    },
    candidateWorkbookCountsMatch,
  ),
  CANDIDATE_PHOTO_ARCHIVE_IMPORTED: fields(
    {
      totalFiles: nonNegativeInteger,
      uploaded: nonNegativeInteger,
      updated: nonNegativeInteger,
      skipped: nonNegativeInteger,
      duplicateCount: nonNegativeInteger,
      policy: oneOf("insert-only", "insert-update", "all"),
      checksum,
    },
    candidatePhotoCountsMatch,
  ),
  SYSTEM_PROFILE_UPDATED: fields({
    schoolName: identifier,
    academicYear: integer({ min: 2000, max: 2100 }),
    systemName: identifier,
    examineeNoUniqueness: oneOf("SYSTEM", "SCHEDULE"),
    pseudonymNoUniqueness: oneOf("ADMISSION", "SCHEDULE"),
  }),
  SYSTEM_LOGO_UPDATED: fields({
    fileName: safeFileName,
    mimeType: oneOf("image/png", "image/jpeg", "image/webp"),
  }),
  SYSTEM_LOGO_REMOVED: fields({}),
  DEVELOPER_PASSWORD_CHANGED: fields({ developerUserId: positiveInteger }),
  WORKSTATION_CREATED: fields(
    {
      workstationId: positiveInteger,
      code: string({ min: 2, max: 100, pattern: /^[A-Z0-9_-]+$/ }),
    },
    undefined,
    { workstationId: "required", printJobId: "forbidden" },
    workstationCorrelationMatchesDetails,
  ),
  FORM_TEMPLATE_SAVED: fields({
    code: string({ min: 2, max: 100, pattern: /^[A-Z0-9_]+$/ }),
    templateId: positiveInteger,
    active: booleanValue,
    riskCount: nonNegativeInteger,
  }),
  FORM_TEMPLATE_METADATA_UPDATED: fields({
    code: string({ min: 2, max: 100, pattern: /^[A-Z0-9_]+$/ }),
    templateId: positiveInteger,
  }),
  FORM_TEMPLATE_AVAILABILITY_UPDATED: fields({
    code: string({ min: 2, max: 100, pattern: /^[A-Z0-9_]+$/ }),
    templateId: positiveInteger,
    active: booleanValue,
  }),
  FORM_TEMPLATE_DELETED: fields({
    code: string({ min: 2, max: 100, pattern: /^[A-Z0-9_]+$/ }),
    templateId: positiveInteger,
  }),
  PSEUDONYM_SETTING_UPDATED: fields({
    settingId: positiveInteger,
    version: positiveInteger,
    assignmentMethod: oneOf("DRAW", "SEQUENTIAL", "MATCHING", "PREASSIGNED"),
    rangeCount: nonNegativeInteger,
    autoDrawEnabled: booleanValue,
    autoDrawDelaySeconds: integer({ min: 1, max: 60 }),
    printPreassignedLabel: booleanValue,
    autoAssignAbsenteesOnClose: booleanValue,
    deleteAbsenteeInfoOnReopen: booleanValue,
    useCandidatePhotos: booleanValue,
    enableBulkDraw: booleanValue,
  }),
  PSEUDONYM_OPERATION_CLOSED: fields({
    operationId: positiveInteger,
    examDate: date,
    examTime: time,
    periodName: shortIdentifier,
    admissionName: identifier,
    autoAssignedAbsenteeCount: nonNegativeInteger,
  }),
  PSEUDONYM_OPERATION_REOPENED: fields({
    operationId: positiveInteger,
    examDate: date,
    examTime: time,
    periodName: shortIdentifier,
    admissionName: identifier,
    deletedAbsenteeCount: nonNegativeInteger,
  }),
  PSEUDONYM_ASSIGNED: fields({
    assignmentId: positiveInteger,
    candidateRecordId: positiveInteger,
    mode: oneOf("RANDOM", "SEQUENTIAL", "MANUAL", "PREASSIGNED"),
  }),
  PRINT_JOB_CREATED: printEventFields({
    jobNo: shortIdentifier,
    copies: integer({ min: 1, max: 10 }),
  }),
  PRINT_JOB_SENT: printEventFields({ status: oneOf("SENT") }),
  PRINT_JOB_FAILED: printEventFields({ status: oneOf("FAILED"), errorRecorded: literal(true) }),
  PRINT_JOB_EXPIRED: printEventFields({
    requestedStatus: oneOf("SENT", "FAILED"),
    status: oneOf("EXPIRED"),
  }),
  PRINT_JOB_REISSUED: printEventFields(
    {
      reissueType: oneOf("RETRY", "REPRINT"),
      reasonCode: oneOf(
        "CLIENT_SEND_RETRY",
        "PRINTER_RECOVERY",
        "LABEL_DAMAGED",
        "PRINT_QUALITY_ISSUE",
        "OPERATOR_REQUEST",
      ),
    },
    printJobReissueReasonMatchesType,
  ),
} as const satisfies Record<MutationAuditEventType, EventContract>;

const envelopeKeys = new Set(["eventType", "actorUserId", "workstationId", "printJobId", "requestId", "details"]);
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeMutationAuditRecord(
  input: MutationAuditRecord,
  inheritedRequestId: string | undefined,
): NormalizedMutationAuditRecord {
  if (!isPlainRecord(input)) throw contractError();
  if (Object.keys(input).some((key) => !envelopeKeys.has(key))) throw contractError();
  if (!isMutationAuditEventType(input.eventType)) throw contractError();
  if (!(input.actorUserId === null || positiveInteger(input.actorUserId))) throw contractError();

  const contract = EVENT_CONTRACTS[input.eventType];
  const workstationId = validateCorrelationField(
    input,
    "workstationId",
    contract.correlation.workstationId,
    positiveInteger,
  );
  const printJobId = validateCorrelationField(
    input,
    "printJobId",
    contract.correlation.printJobId,
    (value) => typeof value === "string" && uuidV4Pattern.test(value),
  );
  const correlation = {
    workstationId: (workstationId as number | undefined) ?? null,
    printJobId: (printJobId as string | undefined) ?? null,
  };

  const requestId = input.requestId ?? inheritedRequestId ?? null;
  if (!(requestId === null || isValidRequestId(requestId))) throw contractError();

  if (!isPlainRecord(input.details)) throw contractError();
  const actualKeys = Object.keys(input.details);
  const expectedEntries = Object.entries(contract.fields);
  if (
    actualKeys.length !== expectedEntries.length ||
    actualKeys.some((key) => !Object.prototype.hasOwnProperty.call(contract.fields, key))
  ) {
    throw contractError();
  }

  const details: Record<string, boolean | number | string> = {};
  const inputDetails = input.details as Readonly<Record<string, unknown>>;
  for (const [key, rule] of expectedEntries) {
    const value = inputDetails[key];
    if (!rule(value)) throw contractError();
    details[key] = value as boolean | number | string;
  }
  if (contract.validateDetails && !contract.validateDetails(details)) throw contractError();
  if (contract.validateRecord && !contract.validateRecord(details, correlation)) throw contractError();

  return {
    eventType: input.eventType,
    actorUserId: input.actorUserId,
    workstationId: correlation.workstationId,
    printJobId: correlation.printJobId,
    requestId,
    details,
  };
}

function isMutationAuditEventType(value: unknown): value is MutationAuditEventType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(EVENT_CONTRACTS, value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fields(
  value: Readonly<Record<string, FieldRule>>,
  validateDetails?: EventContract["validateDetails"],
  correlation: EventCorrelationPolicy = { workstationId: "forbidden", printJobId: "forbidden" },
  validateRecord?: EventContract["validateRecord"],
): EventContract {
  return { fields: value, correlation, validateDetails, validateRecord };
}

function printEventFields(
  value: Readonly<Record<string, FieldRule>>,
  validateDetails?: EventContract["validateDetails"],
): EventContract {
  return fields(value, validateDetails, { workstationId: "required", printJobId: "required" });
}

function integer(options: { min: number; max?: number }): FieldRule {
  return (value) =>
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= options.min &&
    (options.max === undefined || value <= options.max);
}

function string(options: { min?: number; max?: number; pattern?: RegExp }): FieldRule {
  return (value) =>
    typeof value === "string" &&
    (options.min === undefined || value.length >= options.min) &&
    (options.max === undefined || value.length <= options.max) &&
    (options.pattern === undefined || options.pattern.test(value));
}

function oneOf<const Values extends readonly string[]>(...values: Values): FieldRule {
  const allowed = new Set<string>(values);
  return (value) => typeof value === "string" && allowed.has(value);
}

function literal(expected: boolean): FieldRule {
  return (value) => value === expected;
}

function validateCorrelationField(
  input: Readonly<Record<string, unknown>>,
  key: "workstationId" | "printJobId",
  policy: CorrelationPolicy,
  rule: FieldRule,
): unknown {
  const supplied = Object.prototype.hasOwnProperty.call(input, key);
  if (policy === "forbidden") {
    if (supplied) throw contractError();
    return undefined;
  }
  const value = input[key];
  if (!supplied || !rule(value)) throw contractError();
  return value;
}

function candidateWorkbookCountsMatch(details: Readonly<Record<string, boolean | number | string>>): boolean {
  return details.totalRows === Number(details.inserted) + Number(details.updated) + Number(details.skipped);
}

function candidatePhotoCountsMatch(details: Readonly<Record<string, boolean | number | string>>): boolean {
  return (
    details.totalFiles ===
    Number(details.uploaded) + Number(details.updated) + Number(details.skipped) + Number(details.duplicateCount)
  );
}

function printJobReissueReasonMatchesType(details: Readonly<Record<string, boolean | number | string>>): boolean {
  return details.reissueType === "RETRY"
    ? details.reasonCode === "CLIENT_SEND_RETRY" || details.reasonCode === "PRINTER_RECOVERY"
    : details.reasonCode === "LABEL_DAMAGED" ||
        details.reasonCode === "PRINT_QUALITY_ISSUE" ||
        details.reasonCode === "OPERATOR_REQUEST";
}

function workstationCorrelationMatchesDetails(
  details: Readonly<Record<string, boolean | number | string>>,
  correlation: Readonly<{ workstationId: number | null }>,
): boolean {
  return details.workstationId === correlation.workstationId;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (daysInMonth[month - 1] ?? 0);
}

function contractError(): MutationAuditContractError {
  return new MutationAuditContractError("감사 이벤트가 허용된 기록 계약을 위반했습니다.");
}
