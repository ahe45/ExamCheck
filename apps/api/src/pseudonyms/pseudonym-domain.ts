import { createHash, randomInt } from "node:crypto";
import type { PseudonymScheduleScope } from "../uniqueness/number-uniqueness.js";
import type {
  PseudonymAssignmentMethod,
  PseudonymAssignmentMode,
  PseudonymOperationScopeInput,
  PseudonymTimeRangeInput,
  UpdatePseudonymSettingInput,
} from "./pseudonyms.types.js";

export type PseudonymDomainErrorKind = "BAD_REQUEST" | "CONFLICT";

export class PseudonymDomainError extends Error {
  constructor(
    readonly kind: PseudonymDomainErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "PseudonymDomainError";
  }
}

function badRequest(message: string) {
  return new PseudonymDomainError("BAD_REQUEST", message);
}

function conflict(message: string) {
  return new PseudonymDomainError("CONFLICT", message);
}

export interface CandidateScopeSnapshot {
  id: number;
  candidateRecordId: number;
  examineeNo: string;
  examName: string;
  examDate: string | null;
  examTime: string | null;
  period: string | null;
  admission: string | null;
  unit: string | null;
  major: string | null;
  building: string | null;
  room: string | null;
}

export interface CandidateAssignmentSnapshot extends CandidateScopeSnapshot {
  name: string;
}

export interface PseudonymSettingSnapshot {
  id: number;
  version: number;
  examName: string;
  admissionName: string;
  rangeStart: number;
  rangeEnd: number;
  displayWidth?: number;
  nextSequence: number;
  assignmentMethod: PseudonymAssignmentMethod;
  autoDrawEnabled: number | boolean;
  autoDrawDelaySeconds: number;
  printPreassignedLabel: number | boolean;
  labelTemplateId?: number | null;
  autoAssignAbsenteesOnClose: number | boolean;
  deleteAbsenteeInfoOnReopen: number | boolean;
  useCandidatePhotos: number | boolean;
  enableBulkDraw: number | boolean;
}

export interface RangeCursorSnapshot {
  id: number;
  scheduleKey: string;
  rangeStart: number;
  rangeEnd: number;
  displayWidth?: number;
  nextSequence: number;
}

export interface PseudonymTimeRangeSnapshot extends RangeCursorSnapshot {
  date: string;
  time: string;
  period: string;
  admission: string;
  unit: string;
  major: string;
  building: string;
  room: string;
}

export interface ExistingAssignmentScope {
  assignmentId: number;
  examineeNo: string;
  pseudonymNumber: string;
  date: string | null;
  time: string | null;
  period: string | null;
  admission: string | null;
  unit: string | null;
  major: string | null;
  building: string | null;
  room: string | null;
}

export interface AssignmentSnapshot {
  id: number;
  pseudonymNumber: string;
  mode: PseudonymAssignmentMode;
  assignedAt: string | Date;
}

export interface OperationStatusSnapshot {
  closed: number | boolean;
  closedAt: Date | null;
  closedByLoginId: string | null;
}

export interface ScheduleIdentitySnapshot {
  date: string;
  time: string;
  period: string;
  admission: string;
  unit: string;
  major: string;
  building: string;
  room: string;
}

export function assertExpectedSettingVersion(expectedVersion: number, currentVersion: number, created: boolean) {
  const expectedCurrentVersion = created ? 0 : Number(currentVersion);
  if (expectedVersion !== expectedCurrentVersion) throw settingVersionConflict();
}

export function settingVersionConflict() {
  return conflict("다른 사용자가 이 전형의 설정을 먼저 변경했습니다. 최신 설정을 다시 불러온 뒤 다시 시도해 주세요.");
}

export function assertCandidateScopeStable<T extends CandidateScopeSnapshot>(
  identified: T,
  current: T | undefined,
): asserts current is T {
  if (!current || candidateScopeIdentity(identified) !== candidateScopeIdentity(current)) {
    throw conflict("수험생의 전형·교시 정보가 변경되었습니다. 다시 조회해 주세요.");
  }
}

function candidateScopeIdentity(candidate: CandidateScopeSnapshot) {
  return JSON.stringify([
    candidate.id,
    candidate.candidateRecordId,
    candidate.examineeNo,
    candidate.examName,
    candidate.examDate,
    candidate.examTime,
    candidate.period,
    candidate.admission,
    candidate.unit,
    candidate.major,
    candidate.building,
    candidate.room,
  ]);
}

export function operationPseudonymScope(input: PseudonymOperationScopeInput): PseudonymScheduleScope {
  return {
    date: input.examDate,
    time: input.examTime,
    period: input.periodName,
    admission: input.admissionName,
  };
}

export function candidatePseudonymScope(candidate: CandidateScopeSnapshot): PseudonymScheduleScope {
  if (!candidate.examDate || !candidate.examTime || !candidate.period || !candidate.admission) {
    throw conflict("수험생의 전형·교시 정보가 올바르지 않습니다. 수험생 데이터를 확인해 주세요.");
  }
  return {
    date: candidate.examDate,
    time: candidate.examTime,
    period: candidate.period,
    admission: candidate.admission,
  };
}

export function operationStatusResponse(row: OperationStatusSnapshot | undefined, autoAssignedAbsenteeCount: number) {
  return {
    closed: Boolean(row?.closed),
    closedAt: row?.closedAt || null,
    closedByLoginId: row?.closedByLoginId || null,
    autoAssignedAbsenteeCount,
  };
}

export function assignmentModeForSetting(
  method: PseudonymSettingSnapshot["assignmentMethod"],
): PseudonymAssignmentMode {
  if (method === "DRAW") return "RANDOM";
  if (method === "SEQUENTIAL") return "SEQUENTIAL";
  if (method === "MATCHING") return "MANUAL";
  return "PREASSIGNED";
}

export function chooseRandomAvailable(start: number, end: number, reserved: Set<number>): number {
  const size = end - start + 1;
  if (size <= 0) throw badRequest("가번호 범위 설정이 올바르지 않습니다.");
  const offset = randomInt(size);
  for (let index = 0; index < size; index += 1) {
    const candidate = start + ((offset + index) % size);
    if (!reserved.has(candidate)) return candidate;
  }
  throw conflict("지정된 범위에 부여 가능한 가번호가 없습니다.");
}

export function chooseSequentialAvailable(next: number, start: number, end: number, reserved: Set<number>): number {
  const size = end - start + 1;
  if (size <= 0) throw badRequest("가번호 범위 설정이 올바르지 않습니다.");
  const normalized = next >= start && next <= end ? next : start;
  for (let index = 0; index < size; index += 1) {
    const candidate = start + ((normalized - start + index) % size);
    if (!reserved.has(candidate)) return candidate;
  }
  throw conflict("지정된 범위에 부여 가능한 가번호가 없습니다.");
}

export function assertWithinRange(number: number, setting: Pick<PseudonymSettingSnapshot, "rangeStart" | "rangeEnd">) {
  if (number < setting.rangeStart || number > setting.rangeEnd) {
    throw badRequest(`가번호는 ${setting.rangeStart}부터 ${setting.rangeEnd} 사이여야 합니다.`);
  }
}

export function assertAssignmentMethod(
  mode: PseudonymAssignmentMode,
  method: PseudonymSettingSnapshot["assignmentMethod"],
) {
  const allowed =
    method === "DRAW"
      ? mode === "RANDOM"
      : method === "SEQUENTIAL"
        ? mode === "SEQUENTIAL"
        : method === "MATCHING"
          ? mode === "MANUAL"
          : mode === "PREASSIGNED";
  if (!allowed) throw badRequest("시스템 설정에서 선택한 가번호 부여 방식과 현재 작업 방식이 다릅니다.");
}

export function assertScheduleRangeCapacities(
  ranges: readonly PseudonymTimeRangeInput[],
  schedules: Array<ScheduleIdentitySnapshot & { candidateCount: number }>,
  requireAll: boolean,
) {
  const counts = new Map(schedules.map((schedule) => [scheduleIdentity(schedule), Number(schedule.candidateCount)]));
  if (requireAll && ranges.length !== counts.size) throw badRequest("모든 시험 조건의 가번호 범위를 설정해 주세요.");
  for (const range of ranges) {
    const key = scheduleIdentity(range);
    const candidateCount = counts.get(key);
    if (candidateCount === undefined)
      throw badRequest(`${range.date} ${range.time}에 등록된 수험생 데이터가 없습니다.`);
    const capacity = range.rangeEnd - range.rangeStart + 1;
    if (capacity !== candidateCount) {
      throw badRequest(
        `${range.date} ${range.time}의 가번호 범위는 등록 수험생 ${candidateCount}명과 동일한 ${candidateCount}개여야 합니다.`,
      );
    }
  }
}

export function preserveNextSequence(existing: number | undefined, rangeStart: number, rangeEnd: number) {
  return existing !== undefined && existing >= rangeStart && existing <= rangeEnd ? existing : rangeStart;
}

export function hasRangeConfigurationChanged(
  existingSetting: Pick<PseudonymSettingSnapshot, "assignmentMethod" | "rangeStart" | "rangeEnd"> | undefined,
  existingRanges: readonly RangeCursorSnapshot[],
  proposed: Pick<UpdatePseudonymSettingInput, "assignmentMethod" | "rangeStart" | "rangeEnd" | "ranges">,
) {
  if (
    !existingSetting ||
    existingSetting.assignmentMethod !== proposed.assignmentMethod ||
    existingSetting.rangeStart !== proposed.rangeStart ||
    existingSetting.rangeEnd !== proposed.rangeEnd ||
    existingRanges.length !== proposed.ranges.length
  )
    return true;

  const existingByKey = new Map(existingRanges.map((range) => [range.scheduleKey, range]));
  return proposed.ranges.some((range) => {
    const existing = existingByKey.get(scheduleKey(range));
    return !existing || existing.rangeStart !== range.rangeStart || existing.rangeEnd !== range.rangeEnd;
  });
}

export function assertExistingAssignmentsWithinProposedRanges(
  assignments: readonly ExistingAssignmentScope[],
  proposed: Pick<UpdatePseudonymSettingInput, "assignmentMethod" | "rangeStart" | "rangeEnd" | "ranges">,
) {
  const usesScheduleRanges =
    proposed.assignmentMethod === "DRAW" ||
    proposed.assignmentMethod === "SEQUENTIAL" ||
    proposed.assignmentMethod === "MATCHING";
  const proposedRanges = new Map(proposed.ranges.map((range) => [scheduleKey(range), range]));

  for (const assignment of assignments) {
    const number = parseExistingPseudonym(assignment);
    if (!usesScheduleRanges) {
      if (number < proposed.rangeStart || number > proposed.rangeEnd) throwAssignmentRangeConflict(assignment);
      continue;
    }

    if (!hasCompleteAssignmentSchedule(assignment)) throwAssignmentRangeConflict(assignment);
    const range = proposedRanges.get(scheduleKey(assignment));
    if (!range || number < range.rangeStart || number > range.rangeEnd) throwAssignmentRangeConflict(assignment);
  }
}

function parseExistingPseudonym(assignment: ExistingAssignmentScope) {
  if (!/^\d+$/.test(assignment.pseudonymNumber)) throwAssignmentRangeConflict(assignment);
  const number = Number(assignment.pseudonymNumber);
  if (!Number.isSafeInteger(number) || number < 1) throwAssignmentRangeConflict(assignment);
  return number;
}

function hasCompleteAssignmentSchedule(
  assignment: ExistingAssignmentScope,
): assignment is ExistingAssignmentScope & ScheduleIdentitySnapshot {
  return (
    assignment.date !== null &&
    assignment.time !== null &&
    assignment.period !== null &&
    assignment.admission !== null &&
    assignment.unit !== null &&
    assignment.major !== null &&
    assignment.building !== null &&
    assignment.room !== null
  );
}

function throwAssignmentRangeConflict(assignment: ExistingAssignmentScope): never {
  throw conflict(
    `수험번호 ${assignment.examineeNo}의 기존 가번호 ${assignment.pseudonymNumber}가 변경할 범위에 포함되지 않습니다.`,
  );
}

export function settingResponse(
  setting: PseudonymSettingSnapshot,
  ranges: readonly PseudonymTimeRangeSnapshot[],
  admissionName = setting.admissionName,
) {
  return {
    id: setting.id,
    version: setting.admissionName === admissionName ? Number(setting.version) : 0,
    examName: setting.examName,
    admissionName,
    rangeStart: setting.rangeStart,
    rangeEnd: setting.rangeEnd,
    displayWidth: setting.displayWidth ?? Math.max(String(setting.rangeStart).length, String(setting.rangeEnd).length),
    nextSequence: setting.nextSequence,
    assignmentMethod: setting.assignmentMethod,
    autoDrawEnabled: Boolean(setting.autoDrawEnabled),
    autoDrawDelaySeconds: Number(setting.autoDrawDelaySeconds),
    printPreassignedLabel: Boolean(setting.printPreassignedLabel),
    labelTemplateId: setting.labelTemplateId === null ? null : Number(setting.labelTemplateId),
    autoAssignAbsenteesOnClose: Boolean(setting.autoAssignAbsenteesOnClose),
    deleteAbsenteeInfoOnReopen: Boolean(setting.deleteAbsenteeInfoOnReopen),
    useCandidatePhotos: Boolean(setting.useCandidatePhotos),
    enableBulkDraw: Boolean(setting.enableBulkDraw),
    ranges: ranges.map((range) => ({
      date: range.date,
      time: range.time,
      period: range.period,
      admission: range.admission,
      unit: range.unit,
      major: range.major,
      building: range.building,
      room: range.room,
      rangeStart: range.rangeStart,
      rangeEnd: range.rangeEnd,
      displayWidth: range.displayWidth ?? Math.max(String(range.rangeStart).length, String(range.rangeEnd).length),
      nextSequence: range.nextSequence,
    })),
  };
}

export function scheduleIdentity(value: ScheduleIdentitySnapshot) {
  return [
    value.date,
    value.time,
    value.period,
    value.admission,
    value.unit,
    value.major,
    value.building,
    value.room,
  ].join("|");
}

export function scheduleKey(value: ScheduleIdentitySnapshot) {
  return createHash("sha256").update(scheduleIdentity(value)).digest("hex");
}

export function parsePseudonym(value: string): number {
  if (!/^\d+$/.test(value)) throw badRequest("가번호는 숫자로 입력해 주세요.");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw badRequest("가번호 형식이 올바르지 않습니다.");
  return number;
}

export function assignmentResponse(
  candidate: CandidateAssignmentSnapshot,
  assignment: AssignmentSnapshot,
  alreadyAssigned: boolean,
) {
  return {
    id: assignment.id,
    examineeNo: candidate.examineeNo,
    examineeName: candidate.name,
    examName: candidate.examName,
    pseudonymNumber: assignment.pseudonymNumber,
    mode: assignment.mode,
    assignedAt: assignment.assignedAt,
    alreadyAssigned,
  };
}
