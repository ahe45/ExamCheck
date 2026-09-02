import { Injectable } from "@nestjs/common";
import type { RowDataPacket } from "mysql2/promise";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { normalizeCandidateNumber, normalizeSourceCode, parseCanonicalPseudonymNumber } from "./identity-keys.js";
import { normalizeIdentityText } from "./identity-normalization.js";
import type { ShadowProjectionRow, ShadowProjectionValue } from "./identity-shadow.js";

export const IDENTITY_SHADOW_OBSERVATION_TYPES = [
  "identity-shadow.system-profile.v1",
  "identity-shadow.candidate.v1",
  "identity-shadow.candidate-photo.v1",
  "identity-shadow.pseudonym-setting.v1",
  "identity-shadow.pseudonym-range.v1",
  "identity-shadow.operation.v1",
  "identity-shadow.assignment.v1",
  "identity-shadow.account-scope.v1",
  "identity-shadow.print-snapshot.v1",
] as const;

export type IdentityShadowObservationType = (typeof IDENTITY_SHADOW_OBSERVATION_TYPES)[number];

export interface IdentityShadowSnapshotPair {
  observationType: IdentityShadowObservationType;
  sourceHighWaterMark: number;
  legacyRows: readonly ShadowProjectionRow[];
  targetRows: readonly ShadowProjectionRow[];
}

interface SystemProfileRow extends RowDataPacket {
  entityId: number;
  academicYear: number;
  examineeScope: string;
  pseudonymScope: string;
}

interface CandidateRow extends RowDataPacket {
  entityId: number;
  admissionName: string;
  admissionCode: string | null;
  examDate: string;
  startTime: string;
  endTime: string | null;
  periodName: string;
  periodCode: string | null;
  unitName: string;
  unitCode: string | null;
  majorName: string;
  majorCode: string | null;
  buildingName: string;
  buildingCode: string | null;
  roomName: string;
  roomCode: string | null;
  examineeNo: string;
  name: string;
  birthDate: string;
  designatedSort: string;
  groupName: string;
  opt1: string;
  opt2: string;
  opt3: string;
  temporaryNo?: string;
  preassignedValue?: number | null;
  preassignedDisplayWidth?: number | null;
}

interface CandidatePhotoRow extends RowDataPacket {
  entityId: number;
  fileName: string;
  mimeType: string;
  contentHash: string;
}

interface SettingRow extends RowDataPacket {
  entityId: number;
  examName: string;
  admissionName: string | null;
  assignmentMethod: string;
  autoDrawEnabled: number | boolean;
  autoDrawDelaySeconds: number;
  printPreassignedLabel: number | boolean;
  autoAssignAbsenteesOnClose: number | boolean;
  deleteAbsenteeInfoOnReopen: number | boolean;
  useCandidatePhotos: number | boolean;
  enableBulkDraw: number | boolean;
  version: number;
}

interface RangeRow extends RowDataPacket {
  entityId: number;
  sourceSettingId: number;
  admissionName: string;
  examDate: string;
  examTime: string;
  periodName: string;
  unitName: string;
  majorName: string;
  buildingName: string;
  roomName: string;
  rangeStart: number;
  rangeEnd: number;
  nextValue: number;
  displayWidth?: number;
}

interface OperationRow extends RowDataPacket {
  entityId: number;
  examName: string;
  admissionName: string;
  examDate: string;
  examTime: string;
  periodName: string;
  state?: string;
  closed?: number | boolean;
  closedBy: number | null;
  closedAt: string | null;
  reopenedBy: number | null;
  reopenedAt: string | null;
}

interface AssignmentRow extends RowDataPacket {
  entityId: number;
  kind?: "CANONICAL" | "LEGACY_RESERVATION";
  candidateRecordId: number | null;
  admissionName: string | null;
  pseudonymNo?: string;
  pseudonymValue?: number;
  displayWidth?: number;
  assignmentMode?: string;
  isAbsentee?: number | boolean;
  autoAssignedOnClose?: number | boolean;
  assignedBy?: number;
  assignedAt?: string;
}

interface AccountRow extends RowDataPacket {
  entityId: number;
  role: string;
  enabled: number | boolean;
  scopeMode?: string | null;
  admissionName: string | null;
}

interface LegacyPrintRow extends RowDataPacket {
  entityId: string;
  jobNo: string;
  labelType: string;
  businessRef: string | null;
  templateId: number;
  templateVersion: number;
  copies: number;
  payloadFormat: string;
  payload: string;
  createdAt: string;
}

interface TargetPrintRow extends RowDataPacket {
  entityId: string;
  projectionJson: unknown;
}

@Injectable()
export class IdentityShadowSnapshotRepository {
  async loadAll(executor: SqlExecutor): Promise<readonly IdentityShadowSnapshotPair[]> {
    return [
      await this.loadSystemProfile(executor),
      await this.loadCandidates(executor),
      await this.loadCandidatePhotos(executor),
      await this.loadSettings(executor),
      await this.loadRanges(executor),
      await this.loadOperations(executor),
      await this.loadAssignments(executor),
      await this.loadAccounts(executor),
      await this.loadPrintSnapshots(executor),
    ];
  }

  async loadSystemProfile(executor: SqlExecutor): Promise<IdentityShadowSnapshotPair> {
    const [legacy] = await executor.query<SystemProfileRow[]>(
      `SELECT id AS entityId, academic_year AS academicYear,
              examinee_no_uniqueness AS examineeScope,
              pseudonym_no_uniqueness AS pseudonymScope
       FROM system_profile ORDER BY id`,
    );
    const [target] = await executor.query<SystemProfileRow[]>(
      `SELECT cycle.system_profile_id AS entityId, cycle.academic_year AS academicYear,
              policy.examinee_scope AS examineeScope, policy.pseudonym_scope AS pseudonymScope
       FROM exam_cycle cycle
       INNER JOIN number_uniqueness_policy policy ON policy.exam_cycle_id = cycle.id
       WHERE cycle.status = 'ACTIVE'
       ORDER BY cycle.system_profile_id, cycle.id`,
    );
    return pair("identity-shadow.system-profile.v1", legacy.map(mapSystemProfile), target.map(mapSystemProfile));
  }

  async loadCandidates(executor: SqlExecutor): Promise<IdentityShadowSnapshotPair> {
    const [legacy] = await executor.query<CandidateRow[]>(
      `SELECT record.id AS entityId, record.admission AS admissionName,
              NULLIF(record.admission_code, '') AS admissionCode,
              DATE_FORMAT(record.exam_date, '%Y-%m-%d') AS examDate,
              record.start_time AS startTime, NULLIF(record.end_time, '') AS endTime,
              record.period_name AS periodName, NULLIF(record.period_code, '') AS periodCode,
              record.unit_name AS unitName, NULLIF(record.unit_code, '') AS unitCode,
              record.major AS majorName, NULLIF(record.major_code, '') AS majorCode,
              record.building_name AS buildingName, NULLIF(record.building_code, '') AS buildingCode,
              record.room_name AS roomName, NULLIF(record.room_code, '') AS roomCode,
              record.examinee_no AS examineeNo, record.name,
              DATE_FORMAT(record.birth_date, '%Y-%m-%d') AS birthDate,
              record.designated_sort AS designatedSort, record.group_name AS groupName,
              record.opt1, record.opt2, record.opt3, record.temporary_no AS temporaryNo
       FROM candidate_record record ORDER BY record.id`,
    );
    const [target] = await executor.query<CandidateRow[]>(
      `SELECT registration.source_candidate_record_id AS entityId,
              admission.canonical_name AS admissionName, admission.source_code AS admissionCode,
              DATE_FORMAT(slot.exam_date, '%Y-%m-%d') AS examDate,
              TIME_FORMAT(slot.start_time, '%H:%i:%s') AS startTime,
              TIME_FORMAT(slot.end_time, '%H:%i:%s') AS endTime,
              slot.period_canonical_name AS periodName, slot.period_code AS periodCode,
              segment.unit_name AS unitName, segment.unit_code AS unitCode,
              segment.major_name AS majorName, segment.major_code AS majorCode,
              segment.building_name AS buildingName, segment.building_code AS buildingCode,
              segment.room_name AS roomName, segment.room_code AS roomCode,
              candidate_identity.examinee_no_canonical AS examineeNo, candidate_identity.name,
              DATE_FORMAT(candidate_identity.birth_date, '%Y-%m-%d') AS birthDate,
              registration.designated_sort AS designatedSort, registration.group_name AS groupName,
              registration.opt1, registration.opt2, registration.opt3,
              registration.preassigned_value AS preassignedValue,
              registration.preassigned_display_width AS preassignedDisplayWidth
       FROM candidate_registration registration
       INNER JOIN candidate candidate_identity ON candidate_identity.id = registration.candidate_id
       INNER JOIN schedule_segment segment ON segment.id = registration.schedule_segment_id
       INNER JOIN operation_slot slot ON slot.id = segment.operation_slot_id
       INNER JOIN admission ON admission.id = slot.admission_id
       WHERE registration.source_candidate_record_id IS NOT NULL
       ORDER BY registration.source_candidate_record_id, registration.id`,
    );
    return pair(
      "identity-shadow.candidate.v1",
      legacy.map((row) => mapCandidate(row, true)),
      target.map((row) => mapCandidate(row, false)),
    );
  }

  async loadCandidatePhotos(executor: SqlExecutor): Promise<IdentityShadowSnapshotPair> {
    // Deliberately do not select the BLOB. Metadata and the precomputed content hash
    // are sufficient to verify the source bridge without loading image bytes into memory.
    const [legacy] = await executor.query<CandidatePhotoRow[]>(
      `SELECT photo.candidate_record_id AS entityId, photo.file_name AS fileName,
              photo.mime_type AS mimeType, photo.content_hash AS contentHash
       FROM candidate_photo photo ORDER BY photo.candidate_record_id`,
    );
    const [target] = await executor.query<CandidatePhotoRow[]>(
      `SELECT photo.source_candidate_record_id AS entityId, photo.file_name AS fileName,
              photo.mime_type AS mimeType, photo.content_hash AS contentHash
       FROM candidate_identity_photo photo
       WHERE photo.source_candidate_record_id IS NOT NULL
       ORDER BY photo.source_candidate_record_id, photo.candidate_id`,
    );
    return pair("identity-shadow.candidate-photo.v1", legacy.map(mapCandidatePhoto), target.map(mapCandidatePhoto));
  }

  async loadSettings(executor: SqlExecutor): Promise<IdentityShadowSnapshotPair> {
    const [legacy] = await executor.query<SettingRow[]>(
      `SELECT setting.id AS entityId, setting.exam_name AS examName,
              NULLIF(setting.admission_name, '') AS admissionName,
              setting.assignment_method AS assignmentMethod,
              setting.auto_draw_enabled AS autoDrawEnabled,
              setting.auto_draw_delay_seconds AS autoDrawDelaySeconds,
              setting.print_preassigned_label AS printPreassignedLabel,
              setting.auto_assign_absentees_on_close AS autoAssignAbsenteesOnClose,
              setting.delete_absentee_info_on_reopen AS deleteAbsenteeInfoOnReopen,
              setting.use_candidate_photos AS useCandidatePhotos,
              setting.enable_bulk_draw AS enableBulkDraw, setting.version
       FROM pseudonym_setting setting ORDER BY setting.id`,
    );
    const [target] = await executor.query<SettingRow[]>(
      `SELECT policy.source_setting_id AS entityId, cycle.display_name AS examName,
              admission.canonical_name AS admissionName,
              policy.assignment_method AS assignmentMethod,
              policy.auto_draw_enabled AS autoDrawEnabled,
              policy.auto_draw_delay_seconds AS autoDrawDelaySeconds,
              policy.print_preassigned_label AS printPreassignedLabel,
              policy.auto_assign_absentees_on_close AS autoAssignAbsenteesOnClose,
              policy.delete_absentee_info_on_reopen AS deleteAbsenteeInfoOnReopen,
              policy.use_candidate_photos AS useCandidatePhotos,
              policy.enable_bulk_draw AS enableBulkDraw, policy.version
       FROM pseudonym_policy policy
       INNER JOIN exam_cycle cycle ON cycle.id = policy.exam_cycle_id
       LEFT JOIN admission ON admission.id = policy.admission_id
       WHERE policy.source_setting_id IS NOT NULL
       ORDER BY policy.source_setting_id, policy.id`,
    );
    return pair("identity-shadow.pseudonym-setting.v1", legacy.map(mapSetting), target.map(mapSetting));
  }

  async loadRanges(executor: SqlExecutor): Promise<IdentityShadowSnapshotPair> {
    const [legacy] = await executor.query<RangeRow[]>(
      `SELECT range_row.id AS entityId, range_row.setting_id AS sourceSettingId,
              COALESCE(NULLIF(range_row.admission, ''), setting.admission_name) AS admissionName,
              DATE_FORMAT(range_row.exam_date, '%Y-%m-%d') AS examDate,
              range_row.exam_time AS examTime, range_row.period_name AS periodName,
              range_row.unit_name AS unitName, range_row.major AS majorName,
              range_row.building_name AS buildingName, range_row.room_name AS roomName,
              range_row.range_start AS rangeStart, range_row.range_end AS rangeEnd,
              range_row.next_sequence AS nextValue
       FROM pseudonym_time_range range_row
       INNER JOIN pseudonym_setting setting ON setting.id = range_row.setting_id
       ORDER BY range_row.id`,
    );
    const [target] = await executor.query<RangeRow[]>(
      `SELECT range_row.source_time_range_id AS entityId,
              policy.source_setting_id AS sourceSettingId,
              admission.canonical_name AS admissionName,
              DATE_FORMAT(slot.exam_date, '%Y-%m-%d') AS examDate,
              TIME_FORMAT(slot.start_time, '%H:%i:%s') AS examTime,
              slot.period_canonical_name AS periodName,
              segment.unit_name AS unitName, segment.major_name AS majorName,
              segment.building_name AS buildingName, segment.room_name AS roomName,
              range_row.range_start_value AS rangeStart,
              range_row.range_end_value AS rangeEnd, range_row.next_value AS nextValue,
              range_row.display_width AS displayWidth
       FROM pseudonym_range range_row
       INNER JOIN pseudonym_policy policy ON policy.id = range_row.pseudonym_policy_id
       INNER JOIN schedule_segment segment ON segment.id = range_row.schedule_segment_id
       INNER JOIN operation_slot slot ON slot.id = segment.operation_slot_id
       INNER JOIN admission ON admission.id = slot.admission_id
       WHERE range_row.source_time_range_id IS NOT NULL
       ORDER BY range_row.source_time_range_id, range_row.id`,
    );
    return pair(
      "identity-shadow.pseudonym-range.v1",
      legacy.map((row) => mapRange(row, true)),
      target.map((row) => mapRange(row, false)),
    );
  }

  async loadOperations(executor: SqlExecutor): Promise<IdentityShadowSnapshotPair> {
    const [legacy] = await executor.query<OperationRow[]>(
      `SELECT operation.id AS entityId, operation.exam_name AS examName,
              operation.admission_name AS admissionName,
              DATE_FORMAT(operation.exam_date, '%Y-%m-%d') AS examDate,
              operation.exam_time AS examTime, operation.period_name AS periodName,
              operation.closed, operation.closed_by AS closedBy,
              DATE_FORMAT(operation.closed_at, '%Y-%m-%dT%H:%i:%s.%f') AS closedAt,
              operation.reopened_by AS reopenedBy,
              DATE_FORMAT(operation.reopened_at, '%Y-%m-%dT%H:%i:%s.%f') AS reopenedAt
       FROM pseudonym_operation operation ORDER BY operation.id`,
    );
    const [target] = await executor.query<OperationRow[]>(
      `SELECT operation.source_operation_id AS entityId, cycle.display_name AS examName,
              admission.canonical_name AS admissionName,
              DATE_FORMAT(slot.exam_date, '%Y-%m-%d') AS examDate,
              TIME_FORMAT(slot.start_time, '%H:%i:%s') AS examTime,
              slot.period_canonical_name AS periodName, operation.state,
              operation.closed_by AS closedBy,
              DATE_FORMAT(operation.closed_at, '%Y-%m-%dT%H:%i:%s.%f') AS closedAt,
              operation.last_reopened_by AS reopenedBy,
              DATE_FORMAT(operation.last_reopened_at, '%Y-%m-%dT%H:%i:%s.%f') AS reopenedAt
       FROM pseudonym_operation_state operation
       INNER JOIN operation_slot slot ON slot.id = operation.operation_slot_id
       INNER JOIN admission ON admission.id = slot.admission_id
       INNER JOIN exam_cycle cycle ON cycle.id = admission.exam_cycle_id
       WHERE operation.source_operation_id IS NOT NULL
       ORDER BY operation.source_operation_id, operation.id`,
    );
    return pair(
      "identity-shadow.operation.v1",
      legacy.map((row) => mapOperation(row, true)),
      target.map((row) => mapOperation(row, false)),
    );
  }

  async loadAssignments(executor: SqlExecutor): Promise<IdentityShadowSnapshotPair> {
    const [legacy] = await executor.query<AssignmentRow[]>(
      `SELECT assignment.id AS entityId, assignment.candidate_record_id AS candidateRecordId,
              assignment.admission_name AS admissionName, assignment.pseudonym_no AS pseudonymNo,
              assignment.assignment_mode AS assignmentMode, assignment.is_absentee AS isAbsentee,
              assignment.auto_assigned_on_close AS autoAssignedOnClose,
              assignment.assigned_by AS assignedBy,
              DATE_FORMAT(assignment.assigned_at, '%Y-%m-%dT%H:%i:%s.%f') AS assignedAt
       FROM pseudonym_assignment assignment ORDER BY assignment.id`,
    );
    const [canonical] = await executor.query<AssignmentRow[]>(
      `SELECT assignment.source_assignment_id AS entityId, 'CANONICAL' AS kind,
              registration.source_candidate_record_id AS candidateRecordId,
              admission.canonical_name AS admissionName,
              assignment.pseudonym_value AS pseudonymValue,
              assignment.display_width AS displayWidth,
              assignment.assignment_mode AS assignmentMode,
              assignment.is_absentee AS isAbsentee,
              assignment.auto_assigned_on_close AS autoAssignedOnClose,
              assignment.assigned_by AS assignedBy,
              DATE_FORMAT(assignment.assigned_at, '%Y-%m-%dT%H:%i:%s.%f') AS assignedAt
       FROM candidate_pseudonym_assignment assignment
       INNER JOIN candidate_registration registration ON registration.id = assignment.registration_id
       INNER JOIN schedule_segment segment ON segment.id = registration.schedule_segment_id
       INNER JOIN operation_slot slot ON slot.id = segment.operation_slot_id
       INNER JOIN admission ON admission.id = slot.admission_id
       WHERE assignment.source_assignment_id IS NOT NULL
       ORDER BY assignment.source_assignment_id, assignment.id`,
    );
    const [reservations] = await executor.query<AssignmentRow[]>(
      `SELECT reservation.source_assignment_id AS entityId, 'LEGACY_RESERVATION' AS kind,
              NULL AS candidateRecordId, admission.canonical_name AS admissionName,
              reservation.pseudonym_value AS pseudonymValue
       FROM legacy_pseudonym_reservation reservation
       LEFT JOIN admission ON admission.id = reservation.admission_id
       ORDER BY reservation.source_assignment_id, reservation.id`,
    );
    return pair(
      "identity-shadow.assignment.v1",
      legacy.map((row) => mapAssignment(row, true)),
      [...canonical, ...reservations].map((row) => mapAssignment(row, false)),
    );
  }

  async loadAccounts(executor: SqlExecutor): Promise<IdentityShadowSnapshotPair> {
    const [legacy] = await executor.query<AccountRow[]>(
      `SELECT user.id AS entityId, user.role, user.enabled,
              assignment.admission_name AS admissionName
       FROM app_user user
       LEFT JOIN user_admission_assignment assignment ON assignment.user_id = user.id
       ORDER BY user.id, assignment.admission_name`,
    );
    const [target] = await executor.query<AccountRow[]>(
      `SELECT user.id AS entityId, user.role, user.enabled,
              user.admission_scope_mode AS scopeMode,
              admission.canonical_name AS admissionName
       FROM app_user user
       LEFT JOIN user_admission_scope_assignment assignment ON assignment.user_id = user.id
       LEFT JOIN admission ON admission.id = assignment.admission_id
       ORDER BY user.id, admission.canonical_name`,
    );
    return pair("identity-shadow.account-scope.v1", mapAccounts(legacy, true), mapAccounts(target, false));
  }

  async loadPrintSnapshots(executor: SqlExecutor): Promise<IdentityShadowSnapshotPair> {
    const [legacy] = await executor.query<LegacyPrintRow[]>(
      `SELECT job.id AS entityId, job.job_no AS jobNo, job.label_type AS labelType,
              job.business_ref AS businessRef, job.template_id AS templateId,
              job.template_version AS templateVersion, job.copies,
              payload.format AS payloadFormat, payload.payload,
              DATE_FORMAT(job.created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt
       FROM print_job job
       INNER JOIN print_job_payload payload ON payload.print_job_id = job.id
       ORDER BY job.created_at, job.id`,
    );
    const [target] = await executor.query<TargetPrintRow[]>(
      `SELECT snapshot.print_job_id AS entityId, snapshot.projection_json AS projectionJson
       FROM print_projection_snapshot snapshot
       ORDER BY snapshot.print_job_id`,
    );
    return pair("identity-shadow.print-snapshot.v1", legacy.map(mapLegacyPrint), target.map(mapTargetPrint), 0);
  }
}

function mapSystemProfile(row: SystemProfileRow): ShadowProjectionRow {
  return projection(row.entityId, {
    academicYear: Number(row.academicYear),
    examineeScope: row.examineeScope,
    pseudonymScope: row.pseudonymScope,
  });
}

function mapCandidatePhoto(row: CandidatePhotoRow): ShadowProjectionRow {
  return projection(Number(row.entityId), {
    fileName: row.fileName.normalize("NFKC"),
    mimeType: row.mimeType.trim().toLowerCase(),
    contentHash: row.contentHash.trim().toLowerCase(),
  });
}

function mapCandidate(row: CandidateRow, legacy: boolean): ShadowProjectionRow {
  const preassigned = safePseudonym(row.temporaryNo ?? "");
  const candidateNumber = legacy ? safeCandidateNumber(row.examineeNo) : { value: row.examineeNo, invalid: false };
  return projection(Number(row.entityId), {
    admissionName: normalizeIdentityText(row.admissionName),
    admissionCode: normalizeSourceCode(row.admissionCode ?? ""),
    examDate: row.examDate,
    startTime: normalizeTime(row.startTime),
    endTime: normalizeOptionalTime(row.endTime),
    periodName: normalizeIdentityText(row.periodName),
    periodCode: normalizeSourceCode(row.periodCode ?? ""),
    unitName: normalizeIdentityText(row.unitName),
    unitCode: normalizeSourceCode(row.unitCode ?? ""),
    majorName: normalizeIdentityText(row.majorName),
    majorCode: normalizeSourceCode(row.majorCode ?? ""),
    buildingName: normalizeIdentityText(row.buildingName),
    buildingCode: normalizeSourceCode(row.buildingCode ?? ""),
    roomName: normalizeIdentityText(row.roomName),
    roomCode: normalizeSourceCode(row.roomCode ?? ""),
    examineeNo: candidateNumber.value,
    invalidExamineeNo: candidateNumber.invalid,
    name: normalizeIdentityText(row.name),
    birthDate: row.birthDate,
    designatedSort: normalizeIdentityText(row.designatedSort),
    groupName: normalizeIdentityText(row.groupName),
    opt1: normalizeIdentityText(row.opt1),
    opt2: normalizeIdentityText(row.opt2),
    opt3: normalizeIdentityText(row.opt3),
    preassignedValue: legacy ? preassigned.value : nullableNumber(row.preassignedValue),
    preassignedDisplayWidth: legacy ? preassigned.displayWidth : nullableNumber(row.preassignedDisplayWidth),
    invalidPreassigned: legacy ? preassigned.invalid : false,
  });
}

function mapSetting(row: SettingRow): ShadowProjectionRow {
  return projection(Number(row.entityId), {
    examName: normalizeIdentityText(row.examName),
    admissionName: normalizeIdentityText(row.admissionName ?? ""),
    scopeKind: normalizeIdentityText(row.admissionName ?? "") ? "ADMISSION" : "DEFAULT",
    assignmentMethod: row.assignmentMethod,
    autoDrawEnabled: Boolean(row.autoDrawEnabled),
    autoDrawDelaySeconds: Number(row.autoDrawDelaySeconds),
    printPreassignedLabel: Boolean(row.printPreassignedLabel),
    autoAssignAbsenteesOnClose: Boolean(row.autoAssignAbsenteesOnClose),
    deleteAbsenteeInfoOnReopen: Boolean(row.deleteAbsenteeInfoOnReopen),
    useCandidatePhotos: Boolean(row.useCandidatePhotos),
    enableBulkDraw: Boolean(row.enableBulkDraw),
    version: Math.max(1, Number(row.version)),
  });
}

function mapRange(row: RangeRow, legacy: boolean): ShadowProjectionRow {
  const start = Number(row.rangeStart);
  const end = Number(row.rangeEnd);
  return projection(Number(row.entityId), {
    sourceSettingId: Number(row.sourceSettingId),
    admissionName: normalizeIdentityText(row.admissionName),
    examDate: row.examDate,
    examTime: normalizeTime(row.examTime),
    periodName: normalizeIdentityText(row.periodName),
    unitName: normalizeIdentityText(row.unitName),
    majorName: normalizeIdentityText(row.majorName),
    buildingName: normalizeIdentityText(row.buildingName),
    roomName: normalizeIdentityText(row.roomName),
    rangeStart: start,
    rangeEnd: end,
    nextValue: Number(row.nextValue),
    displayWidth: legacy ? Math.max(String(start).length, String(end).length) : Number(row.displayWidth),
  });
}

function mapOperation(row: OperationRow, legacy: boolean): ShadowProjectionRow {
  return projection(Number(row.entityId), {
    examName: normalizeIdentityText(row.examName),
    admissionName: normalizeIdentityText(row.admissionName),
    examDate: row.examDate,
    examTime: normalizeTime(row.examTime),
    periodName: normalizeIdentityText(row.periodName),
    state: legacy ? (row.closed ? "CLOSED" : "OPEN") : (row.state ?? ""),
    closedBy: nullableNumber(row.closedBy),
    closedAt: row.closedAt,
    reopenedBy: nullableNumber(row.reopenedBy),
    reopenedAt: row.reopenedAt,
  });
}

function mapAssignment(row: AssignmentRow, legacy: boolean): ShadowProjectionRow {
  const kind = legacy ? (row.candidateRecordId === null ? "LEGACY_RESERVATION" : "CANONICAL") : row.kind;
  const parsed = safePseudonym(row.pseudonymNo ?? "");
  if (kind === "LEGACY_RESERVATION") {
    return projection(Number(row.entityId), {
      kind,
      admissionName: normalizeIdentityText(row.admissionName ?? ""),
      pseudonymValue: legacy ? parsed.value : Number(row.pseudonymValue),
      invalidPseudonym: legacy ? parsed.invalid : false,
    });
  }
  return projection(Number(row.entityId), {
    kind: "CANONICAL",
    candidateRecordId: nullableNumber(row.candidateRecordId),
    admissionName: normalizeIdentityText(row.admissionName ?? ""),
    pseudonymValue: legacy ? parsed.value : Number(row.pseudonymValue),
    displayWidth: legacy ? parsed.displayWidth : Number(row.displayWidth),
    invalidPseudonym: legacy ? parsed.invalid : false,
    assignmentMode: row.assignmentMode ?? "",
    isAbsentee: Boolean(row.isAbsentee),
    autoAssignedOnClose: Boolean(row.autoAssignedOnClose),
    assignedBy: Number(row.assignedBy),
    assignedAt: row.assignedAt ?? null,
  });
}

function mapAccounts(rows: readonly AccountRow[], legacy: boolean): ShadowProjectionRow[] {
  const grouped = new Map<
    number,
    { role: string; enabled: boolean; scopeMode: string | null; admissions: Set<string> }
  >();
  for (const row of rows) {
    const entityId = Number(row.entityId);
    const current = grouped.get(entityId) ?? {
      role: row.role,
      enabled: Boolean(row.enabled),
      scopeMode: row.scopeMode ?? null,
      admissions: new Set<string>(),
    };
    const admissionName = normalizeIdentityText(row.admissionName ?? "");
    const legacyRoleUsesAssignments = row.role === "OPERATOR" || row.role === "VIEWER";
    if (admissionName && (!legacy || legacyRoleUsesAssignments)) current.admissions.add(admissionName);
    grouped.set(entityId, current);
  }
  return [...grouped.entries()].map(([entityId, value]) => {
    const expectedMode =
      value.role === "OPERATOR" || value.role === "VIEWER" ? (value.admissions.size > 0 ? "ASSIGNED" : "ALL") : "ALL";
    return projection(entityId, {
      role: value.role,
      enabled: value.enabled,
      scopeMode: legacy ? expectedMode : (value.scopeMode ?? "UNMAPPED"),
      admissionNames: [...value.admissions].sort(),
    });
  });
}

function mapLegacyPrint(row: LegacyPrintRow): ShadowProjectionRow {
  return projection(row.entityId, {
    projectionVersion: 1,
    sourceKind: "LEGACY_PRINT_JOB",
    jobNo: row.jobNo,
    labelType: row.labelType,
    businessRef: row.businessRef,
    templateId: Number(row.templateId),
    templateVersion: Number(row.templateVersion),
    copies: Number(row.copies),
    payloadFormat: row.payloadFormat,
    payload: row.payload,
    createdAt: row.createdAt,
  });
}

function mapTargetPrint(row: TargetPrintRow): ShadowProjectionRow {
  return projection(row.entityId, parseProjectionJson(row.projectionJson));
}

function parseProjectionJson(value: unknown): Readonly<Record<string, ShadowProjectionValue>> {
  const parsed: unknown =
    typeof value === "string" ? JSON.parse(value) : Buffer.isBuffer(value) ? JSON.parse(value.toString("utf8")) : value;
  if (!isProjectionObject(parsed)) throw new TypeError("Stored print projection is not a safe JSON object.");
  return parsed;
}

function isProjectionObject(value: unknown): value is Readonly<Record<string, ShadowProjectionValue>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(isProjectionValue);
}

function isProjectionValue(value: unknown): value is ShadowProjectionValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isProjectionValue);
  return isProjectionObject(value);
}

function pair(
  observationType: IdentityShadowObservationType,
  legacyRows: readonly ShadowProjectionRow[],
  targetRows: readonly ShadowProjectionRow[],
  sourceHighWaterMark = maxNumericEntityId(legacyRows),
): IdentityShadowSnapshotPair {
  return { observationType, sourceHighWaterMark, legacyRows, targetRows };
}

function projection(
  entityId: number | string,
  value: Readonly<Record<string, ShadowProjectionValue>>,
): ShadowProjectionRow {
  return { entityId, projection: value };
}

function maxNumericEntityId(rows: readonly ShadowProjectionRow[]): number {
  return rows.reduce(
    (maximum, row) => (typeof row.entityId === "number" ? Math.max(maximum, row.entityId) : maximum),
    0,
  );
}

function normalizeTime(value: string): string {
  const trimmed = value.trim();
  return trimmed.length === 5 ? `${trimmed}:00` : trimmed;
}

function normalizeOptionalTime(value: string | null): string | null {
  return value ? normalizeTime(value) : null;
}

function nullableNumber(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function safePseudonym(raw: string): { value: number | null; displayWidth: number | null; invalid: boolean } {
  try {
    const parsed = parseCanonicalPseudonymNumber(raw);
    return { value: parsed?.value ?? null, displayWidth: parsed?.displayWidth ?? null, invalid: false };
  } catch {
    return { value: null, displayWidth: null, invalid: true };
  }
}

function safeCandidateNumber(raw: string): { value: string | null; invalid: boolean } {
  try {
    return { value: normalizeCandidateNumber(raw), invalid: false };
  } catch {
    return { value: null, invalid: true };
  }
}
