import { findActiveLabelTemplate } from "../label-templates/active-label-template.js";
import { Injectable } from "@nestjs/common";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { AdmissionAccessPredicate } from "../authorization/admission-policy.js";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import {
  pseudonymUniquenessScopeKey,
  type PseudonymNoUniqueness,
  type PseudonymScheduleScope,
} from "../uniqueness/number-uniqueness.js";
import { parsePseudonym, type CandidateScopeSnapshot, type ExistingAssignmentScope } from "./pseudonym-domain.js";
import {
  buildOperationRosterFilterSql,
  operationRosterSelectSql,
  PSEUDONYM_ROSTER_EXPORT_MAX_ROWS,
  type CanonicalPseudonymRosterRow,
  type PseudonymRosterFilterSpecification,
} from "./pseudonym-roster-query.js";
import type {
  AdmissionOperationScheduleInput,
  AssignPseudonymInput,
  PseudonymAssignmentMode,
  PseudonymOperationScopeInput,
  PseudonymTimeRangeInput,
  UpdatePseudonymSettingInput,
} from "./pseudonyms.types.js";

export interface CandidateRow extends RowDataPacket, CandidateScopeSnapshot {
  name: string;
  preassignedNumber: string | null;
}

export interface SettingRow extends RowDataPacket {
  id: number;
  version: number;
  examName: string;
  admissionName: string;
  rangeStart: number;
  rangeEnd: number;
  displayWidth: number;
  nextSequence: number;
  assignmentMethod: "DRAW" | "SEQUENTIAL" | "MATCHING" | "PREASSIGNED";
  autoDrawEnabled: boolean | number;
  autoDrawDelaySeconds: number;
  printPreassignedLabel: boolean | number;
  labelTemplateId: number | null;
  autoAssignAbsenteesOnClose: boolean | number;
  deleteAbsenteeInfoOnReopen: boolean | number;
  useCandidatePhotos: boolean | number;
  enableBulkDraw: boolean | number;
}

export interface TimeRangeRow extends RowDataPacket {
  id: number;
  date: string;
  time: string;
  period: string;
  admission: string;
  unit: string;
  major: string;
  building: string;
  room: string;
  scheduleKey: string;
  rangeStart: number;
  rangeEnd: number;
  displayWidth: number;
  nextSequence: number;
}

export interface AdmissionSettingsOverview {
  name: string;
  candidates: number;
  dates: number;
  schedules: number;
  buildings: string[];
}

interface AdmissionSettingsOverviewRow extends RowDataPacket {
  name: string;
  candidates: number | string;
  dates: number | string;
  schedules: number | string;
  buildings: string | null;
}

export interface OverviewTimeRangeRow extends TimeRangeRow {
  settingId: number;
}

interface AdmissionOperationScheduleRow extends RowDataPacket {
  examDate: string;
  examTime: string;
  periodName: string;
  buildingNames: string | null;
  candidateCount: number | string;
  assignedCount: number | string;
  closed: number | boolean;
}

interface PasswordRow extends RowDataPacket {
  passwordHash: string | null;
}

export interface AssignmentData {
  id: number;
  pseudonymNumber: string;
  mode: PseudonymAssignmentMode;
  assignedAt: string | Date;
}

interface AssignmentRow extends RowDataPacket, AssignmentData {}

interface IdRow extends RowDataPacket {
  id: number;
}

export interface ScheduleCountRow extends RowDataPacket {
  date: string;
  time: string;
  period: string;
  admission: string;
  unit: string;
  major: string;
  building: string;
  room: string;
  candidateCount: number;
}

export interface OperationStatusRow extends RowDataPacket {
  closed: number | boolean;
  closedAt: Date | null;
  closedByLoginId: string | null;
}

interface OperationRosterRow extends RowDataPacket, CanonicalPseudonymRosterRow {}

export interface OperationLockRow {
  id: number;
  closed: number | boolean;
}

interface ExistingAssignmentScopeRow extends RowDataPacket, ExistingAssignmentScope {}

interface NumberRow extends RowDataPacket {
  pseudonymNumber: string;
}

interface PseudonymPolicyRow extends RowDataPacket {
  pseudonymNoUniqueness: PseudonymNoUniqueness;
}

@Injectable()
export class PseudonymsRepository {
  async findLabelPrintDefaults(executor: SqlExecutor, labelTemplateId: number | null) {
    const template = await findActiveLabelTemplate(executor, labelTemplateId);
    return template
      ? { templateId: Number(template.id), templateName: template.name, copies: Number(template.defaultCopies) }
      : null;
  }

  async findSetting(
    executor: SqlExecutor,
    examName: string,
    admissionName: string,
    options: { forUpdate: boolean },
  ): Promise<SettingRow | undefined> {
    const [rows] = await executor.execute<SettingRow[]>(
      `${settingSelectSql}
       WHERE exam_name = ? AND admission_name IN (?, '') AND active = TRUE
       ORDER BY CASE WHEN admission_name = ? THEN 0 ELSE 1 END LIMIT 1${options.forUpdate ? " FOR UPDATE" : ""}`,
      [examName, admissionName, admissionName],
    );
    return rows[0];
  }

  async listAdmissionSettingsOverview(
    executor: SqlExecutor,
    access: AdmissionAccessPredicate,
  ): Promise<AdmissionSettingsOverview[]> {
    const [rows] = await executor.execute<AdmissionSettingsOverviewRow[]>(
      `SELECT TRIM(cr.admission) AS name, COUNT(*) AS candidates,
              COUNT(DISTINCT DATE_FORMAT(cr.exam_date, '%Y-%m-%d')) AS dates,
              COUNT(DISTINCT CONCAT_WS('\u001e', DATE_FORMAT(cr.exam_date, '%Y-%m-%d'),
                cr.start_time, cr.period_name)) AS schedules,
              GROUP_CONCAT(DISTINCT NULLIF(TRIM(cr.building_name), '')
                ORDER BY TRIM(cr.building_name) SEPARATOR '\u001f') AS buildings
       FROM candidate_record cr
       WHERE ${access.sql} AND TRIM(cr.admission) <> ''
       GROUP BY TRIM(cr.admission)
       ORDER BY name`,
      access.params,
    );
    return rows.map((row) => ({
      name: row.name,
      candidates: Number(row.candidates),
      dates: Number(row.dates),
      schedules: Number(row.schedules),
      buildings: row.buildings ? row.buildings.split("\u001f") : [],
    }));
  }

  async listSettingsForOverview(
    executor: SqlExecutor,
    examName: string,
    admissionNames: readonly string[],
  ): Promise<SettingRow[]> {
    if (!admissionNames.length) return [];
    const settingAdmissions = ["", ...new Set(admissionNames)];
    const [rows] = await executor.execute<SettingRow[]>(
      `${settingSelectSql}
       WHERE exam_name = ? AND active = TRUE
         AND admission_name IN (${settingAdmissions.map(() => "?").join(", ")})
       ORDER BY admission_name`,
      [examName, ...settingAdmissions],
    );
    return rows;
  }

  async listTimeRangesForOverview(
    executor: SqlExecutor,
    settingIds: readonly number[],
    admissionNames: readonly string[],
  ): Promise<OverviewTimeRangeRow[]> {
    if (!settingIds.length || !admissionNames.length) return [];
    const uniqueSettingIds = [...new Set(settingIds)];
    const uniqueAdmissionNames = [...new Set(admissionNames)];
    const [rows] = await executor.execute<OverviewTimeRangeRow[]>(
      `SELECT setting_id AS settingId, id, DATE_FORMAT(exam_date, '%Y-%m-%d') AS date,
              exam_time AS time, period_name AS period, admission, unit_name AS unit, major,
              building_name AS building, room_name AS room, schedule_key AS scheduleKey,
              range_start AS rangeStart, range_end AS rangeEnd, display_width AS displayWidth,
              next_sequence AS nextSequence
       FROM pseudonym_time_range
       WHERE setting_id IN (${uniqueSettingIds.map(() => "?").join(", ")})
         AND admission IN (${uniqueAdmissionNames.map(() => "?").join(", ")})
       ORDER BY setting_id, admission, exam_date, exam_time`,
      [...uniqueSettingIds, ...uniqueAdmissionNames],
    );
    return rows;
  }

  async listAdmissionOperationSchedules(executor: SqlExecutor, examName: string, admissionName: string) {
    const [rows] = await executor.execute<AdmissionOperationScheduleRow[]>(
      `SELECT DATE_FORMAT(cr.exam_date, '%Y-%m-%d') AS examDate, cr.start_time AS examTime,
              cr.period_name AS periodName,
              GROUP_CONCAT(DISTINCT NULLIF(TRIM(cr.building_name), '')
                ORDER BY TRIM(cr.building_name) SEPARATOR '\u001f') AS buildingNames,
              COUNT(DISTINCT cr.id) AS candidateCount,
              COUNT(DISTINCT pa.id) AS assignedCount,
              MAX(COALESCE(po.closed, FALSE)) AS closed
       FROM candidate_record cr
       LEFT JOIN pseudonym_assignment pa ON pa.candidate_record_id = cr.id
       LEFT JOIN pseudonym_operation po
         ON po.exam_name = cr.exam_name AND po.exam_date = cr.exam_date
        AND po.exam_time = cr.start_time AND po.period_name = cr.period_name
        AND po.admission_name = cr.admission
       WHERE cr.exam_name = ? AND cr.admission = ?
       GROUP BY cr.exam_date, cr.start_time, cr.period_name
       ORDER BY cr.exam_date, cr.start_time, cr.period_name`,
      [examName, admissionName],
    );
    return rows.map((row) => ({
      examDate: row.examDate,
      examTime: row.examTime,
      periodName: row.periodName,
      buildingNames: row.buildingNames ? row.buildingNames.split("\u001f") : [],
      candidateCount: Number(row.candidateCount),
      assignedCount: Number(row.assignedCount),
      closed: Boolean(row.closed),
    }));
  }

  async findHistoryResetPasswordForUpdate(executor: SqlExecutor): Promise<string | null> {
    const [rows] = await executor.execute<RowDataPacket[]>(
      "SELECT history_reset_password_hash AS passwordHash FROM system_profile WHERE id = 1 FOR UPDATE",
    );
    return rows[0]?.passwordHash ?? null;
  }

  async lockHistoryCandidates(executor: SqlExecutor, scope: PseudonymOperationScopeInput) {
    const [rows] = await executor.execute<RowDataPacket[]>(
      "SELECT cr.id FROM candidate_record cr WHERE " + historyCandidatePredicate + " ORDER BY cr.id FOR UPDATE",
      historyScopeParams(scope),
    );
    return rows;
  }

  async lockHistoryCandidate(
    executor: SqlExecutor,
    scope: PseudonymOperationScopeInput,
    candidateRecordId: number,
    examineeNo: string,
  ) {
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT cr.id FROM candidate_record cr WHERE ${historyCandidatePredicate}
       AND cr.id = ? AND cr.examinee_no = ? FOR UPDATE`,
      [...historyScopeParams(scope), candidateRecordId, examineeNo],
    );
    return rows.length > 0;
  }

  async deleteCandidateHistory(
    executor: SqlExecutor,
    candidateRecordId: number,
    mode: "LABEL" | "ASSIGNMENT",
    clearPreassigned: boolean,
  ) {
    const [pending] = await executor.execute<RowDataPacket[]>(
      `SELECT id FROM print_job WHERE candidate_record_id = ? AND label_type = 'PSEUDONYM_LABEL'
       AND status IN ('CREATED', 'READY', 'DISPATCHING') AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1 FOR UPDATE`,
      [candidateRecordId],
    );
    if (pending.length) return null;
    if (mode === "LABEL") {
      const [result] = await executor.execute<ResultSetHeader>(
        `UPDATE print_job SET status = 'CANCELLED', sent_at = NULL, dispatched_at = NULL
         WHERE candidate_record_id = ? AND label_type = 'PSEUDONYM_LABEL' AND status <> 'CANCELLED'`,
        [candidateRecordId],
      );
      return { resetPrintCount: Number(result.affectedRows), deletedAssignmentCount: 0, clearedPreassigned: false };
    }
    const [result] = await executor.execute<ResultSetHeader>(
      "DELETE FROM pseudonym_assignment WHERE candidate_record_id = ?",
      [candidateRecordId],
    );
    if (clearPreassigned)
      await executor.execute("UPDATE candidate_record SET temporary_no = '' WHERE id = ?", [candidateRecordId]);
    return {
      resetPrintCount: 0,
      deletedAssignmentCount: Number(result.affectedRows),
      clearedPreassigned: clearPreassigned,
    };
  }

  async hasPendingSchedulePrintJobs(executor: SqlExecutor, scope: PseudonymOperationScopeInput) {
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT pj.id FROM print_job pj INNER JOIN candidate_record cr ON cr.id = pj.candidate_record_id
       WHERE ${historyCandidatePredicate} AND pj.label_type = 'PSEUDONYM_LABEL'
         AND pj.status IN ('CREATED', 'READY', 'DISPATCHING') AND (pj.expires_at IS NULL OR pj.expires_at > NOW())
       LIMIT 1 FOR UPDATE`,
      historyScopeParams(scope),
    );
    return rows.length > 0;
  }

  async resetSchedulePrintHistory(executor: SqlExecutor, scope: PseudonymOperationScopeInput) {
    const [result] = await executor.execute<ResultSetHeader>(
      `UPDATE print_job pj INNER JOIN candidate_record cr ON cr.id = pj.candidate_record_id
       SET pj.status = 'CANCELLED', pj.sent_at = NULL, pj.dispatched_at = NULL
       WHERE ${historyCandidatePredicate} AND pj.label_type = 'PSEUDONYM_LABEL' AND pj.status <> 'CANCELLED'`,
      historyScopeParams(scope),
    );
    return Number(result.affectedRows);
  }

  async deleteScheduleAssignments(
    executor: SqlExecutor,
    examName: string,
    admissionName: string,
    schedules: readonly AdmissionOperationScheduleInput[],
  ): Promise<number> {
    const selection = scheduleSelectionSql("cr", schedules);
    const [result] = await executor.execute<ResultSetHeader>(
      `DELETE pa FROM pseudonym_assignment pa
       INNER JOIN candidate_record cr ON cr.id = pa.candidate_record_id
       WHERE pa.exam_name = ? AND pa.admission_name = ?
         AND cr.exam_name = ? AND cr.admission = ? AND (${selection.sql})`,
      [examName, admissionName, examName, admissionName, ...selection.parameters],
    );
    return Number(result.affectedRows);
  }

  async deleteScheduleOperations(
    executor: SqlExecutor,
    examName: string,
    admissionName: string,
    schedules: readonly AdmissionOperationScheduleInput[],
  ): Promise<number> {
    const selection = scheduleSelectionSql("pseudonym_operation", schedules, {
      date: "exam_date",
      time: "exam_time",
      period: "period_name",
    });
    const [result] = await executor.execute<ResultSetHeader>(
      `DELETE FROM pseudonym_operation
       WHERE exam_name = ? AND admission_name = ? AND (${selection.sql})`,
      [examName, admissionName, ...selection.parameters],
    );
    return Number(result.affectedRows);
  }

  async resetScheduleRangeSequences(
    executor: SqlExecutor,
    examName: string,
    admissionName: string,
    schedules: readonly AdmissionOperationScheduleInput[],
    actorUserId: number,
  ): Promise<number> {
    const selection = scheduleSelectionSql("ptr", schedules, {
      date: "exam_date",
      time: "exam_time",
      period: "period_name",
    });
    const [result] = await executor.execute<ResultSetHeader>(
      `UPDATE pseudonym_time_range ptr
       INNER JOIN pseudonym_setting ps ON ps.id = ptr.setting_id
       SET ptr.next_sequence = ptr.range_start, ptr.updated_by = ?
       WHERE ps.exam_name = ? AND ptr.admission = ? AND (${selection.sql})`,
      [actorUserId, examName, admissionName, ...selection.parameters],
    );
    return Number(result.affectedRows);
  }

  async findUserPasswordForUpdate(executor: SqlExecutor, userId: number): Promise<string | null | undefined> {
    const [rows] = await executor.execute<PasswordRow[]>(
      "SELECT password_hash AS passwordHash FROM app_user WHERE id = ? AND enabled = TRUE LIMIT 1 FOR UPDATE",
      [userId],
    );
    return rows[0]?.passwordHash;
  }

  async lockAdmissionCandidateIds(executor: SqlExecutor, admissionName: string): Promise<number[]> {
    const [rows] = await executor.execute<IdRow[]>(
      "SELECT id FROM candidate_record WHERE admission = ? ORDER BY id FOR UPDATE",
      [admissionName],
    );
    return rows.map((row) => Number(row.id));
  }

  async deleteAdmissionAssignments(executor: SqlExecutor, admissionName: string): Promise<number> {
    const [result] = await executor.execute<ResultSetHeader>(
      `DELETE pa FROM pseudonym_assignment pa
       LEFT JOIN candidate_record cr ON cr.id = pa.candidate_record_id
       WHERE pa.admission_name = ? OR cr.admission = ?`,
      [admissionName, admissionName],
    );
    return Number(result.affectedRows);
  }

  async deleteAdmissionCandidates(executor: SqlExecutor, admissionName: string): Promise<number> {
    const [result] = await executor.execute<ResultSetHeader>("DELETE FROM candidate_record WHERE admission = ?", [
      admissionName,
    ]);
    return Number(result.affectedRows);
  }

  async deleteAdmissionOperations(executor: SqlExecutor, admissionName: string): Promise<number> {
    const [result] = await executor.execute<ResultSetHeader>(
      "DELETE FROM pseudonym_operation WHERE admission_name = ?",
      [admissionName],
    );
    return Number(result.affectedRows);
  }

  async deleteAdmissionTimeRanges(executor: SqlExecutor, admissionName: string): Promise<number> {
    const [result] = await executor.execute<ResultSetHeader>("DELETE FROM pseudonym_time_range WHERE admission = ?", [
      admissionName,
    ]);
    return Number(result.affectedRows);
  }

  async deleteAdmissionSettings(executor: SqlExecutor, admissionName: string): Promise<number> {
    const [result] = await executor.execute<ResultSetHeader>("DELETE FROM pseudonym_setting WHERE admission_name = ?", [
      admissionName,
    ]);
    return Number(result.affectedRows);
  }

  async deleteUserAdmissionAssignments(executor: SqlExecutor, admissionName: string): Promise<number> {
    const [result] = await executor.execute<ResultSetHeader>(
      "DELETE FROM user_admission_assignment WHERE admission_name = ?",
      [admissionName],
    );
    return Number(result.affectedRows);
  }

  async findExactSettingForUpdate(
    executor: SqlExecutor,
    examName: string,
    admissionName: string,
  ): Promise<SettingRow | undefined> {
    const [rows] = await executor.execute<SettingRow[]>(
      `${settingSelectSql}
       WHERE exam_name = ? AND admission_name = ?
       LIMIT 1 FOR UPDATE`,
      [examName, admissionName],
    );
    return rows[0];
  }

  async listTimeRanges(executor: SqlExecutor, settingId: number, admissionName: string): Promise<TimeRangeRow[]> {
    const [rows] = await executor.execute<TimeRangeRow[]>(
      `SELECT id, DATE_FORMAT(exam_date, '%Y-%m-%d') AS date, exam_time AS time,
              period_name AS period, admission, unit_name AS unit, major,
              building_name AS building, room_name AS room, schedule_key AS scheduleKey,
              range_start AS rangeStart, range_end AS rangeEnd, display_width AS displayWidth,
              next_sequence AS nextSequence
       FROM pseudonym_time_range WHERE setting_id = ? AND admission = ? ORDER BY exam_date, exam_time`,
      [settingId, admissionName],
    );
    return rows;
  }

  async listTimeRangesForUpdate(executor: SqlExecutor, settingId: number): Promise<TimeRangeRow[]> {
    const [rows] = await executor.execute<TimeRangeRow[]>(
      `SELECT id, schedule_key AS scheduleKey,
              DATE_FORMAT(exam_date, '%Y-%m-%d') AS date, exam_time AS time,
              period_name AS period, admission, unit_name AS unit, major,
              building_name AS building, room_name AS room,
              range_start AS rangeStart, range_end AS rangeEnd, display_width AS displayWidth,
              next_sequence AS nextSequence
       FROM pseudonym_time_range
       WHERE setting_id = ?
       ORDER BY schedule_key
       FOR UPDATE`,
      [settingId],
    );
    return rows;
  }

  async listScheduleCounts(executor: SqlExecutor, examName: string, admissionName: string) {
    const [rows] = await executor.query<ScheduleCountRow[]>(
      `SELECT DATE_FORMAT(cr.exam_date, '%Y-%m-%d') AS date, cr.start_time AS time,
              cr.period_name AS period, cr.admission, cr.unit_name AS unit, cr.major,
              cr.building_name AS building, cr.room_name AS room, COUNT(*) AS candidateCount
       FROM candidate_record cr
       WHERE cr.exam_name = ? AND cr.status = 'ACTIVE' AND cr.admission = ?
       GROUP BY cr.exam_date, cr.start_time, cr.period_name, cr.admission,
                cr.unit_name, cr.major, cr.building_name, cr.room_name
       ORDER BY cr.exam_date, cr.start_time, cr.period_name, cr.admission,
                cr.unit_name, cr.major, cr.building_name, cr.room_name`,
      [examName, admissionName],
    );
    return rows;
  }

  async listAssignmentScopesForUpdate(
    executor: SqlExecutor,
    examName: string,
    admissionName: string,
  ): Promise<ExistingAssignmentScopeRow[]> {
    const [rows] = await executor.execute<ExistingAssignmentScopeRow[]>(
      `SELECT pa.id AS assignmentId, cr.examinee_no AS examineeNo,
              pa.pseudonym_no AS pseudonymNumber,
              DATE_FORMAT(cr.exam_date, '%Y-%m-%d') AS date, cr.start_time AS time,
              cr.period_name AS period, cr.admission, cr.unit_name AS unit, cr.major,
              cr.building_name AS building, cr.room_name AS room
       FROM pseudonym_assignment pa
       INNER JOIN candidate_record cr ON cr.id = pa.candidate_record_id AND cr.admission = ?
       WHERE pa.exam_name = ? AND pa.admission_name = ?
       ORDER BY pa.id, cr.exam_date, cr.start_time, cr.period_name, cr.id
       FOR UPDATE`,
      [admissionName, examName, admissionName],
    );
    return rows;
  }

  async updateSetting(
    executor: SqlExecutor,
    settingId: number,
    expectedVersion: number,
    nextSequence: number,
    input: UpdatePseudonymSettingInput,
    actorUserId: number,
  ): Promise<number> {
    const [result] = await executor.execute<ResultSetHeader>(
      `UPDATE pseudonym_setting
       SET range_start = ?, range_end = ?, display_width = ?, next_sequence = ?, assignment_method = ?,
           auto_draw_enabled = ?, auto_draw_delay_seconds = ?, print_preassigned_label = ?, label_template_id = ?,
           auto_assign_absentees_on_close = ?, delete_absentee_info_on_reopen = ?,
           use_candidate_photos = ?, enable_bulk_draw = ?, active = TRUE, updated_by = ?, version = version + 1
       WHERE id = ? AND version = ?`,
      [
        input.rangeStart,
        input.rangeEnd,
        input.displayWidth ?? rangeDisplayWidth(input.rangeStart, input.rangeEnd),
        nextSequence,
        input.assignmentMethod,
        input.autoDrawEnabled,
        input.autoDrawDelaySeconds,
        input.printPreassignedLabel,
        input.labelTemplateId ?? null,
        input.autoAssignAbsenteesOnClose,
        input.deleteAbsenteeInfoOnReopen,
        input.useCandidatePhotos,
        input.enableBulkDraw,
        actorUserId,
        settingId,
        expectedVersion,
      ],
    );
    return Number(result.affectedRows);
  }

  async insertSetting(
    executor: SqlExecutor,
    nextSequence: number,
    input: UpdatePseudonymSettingInput,
    actorUserId: number,
  ): Promise<number> {
    const [result] = await executor.execute<ResultSetHeader>(
      `INSERT INTO pseudonym_setting
        (exam_name, admission_name, range_start, range_end, display_width, next_sequence, assignment_method,
         auto_draw_enabled, auto_draw_delay_seconds, print_preassigned_label, label_template_id,
         auto_assign_absentees_on_close, delete_absentee_info_on_reopen,
         use_candidate_photos, enable_bulk_draw, active, updated_by, version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, 1)`,
      [
        input.examName,
        input.admissionName,
        input.rangeStart,
        input.rangeEnd,
        input.displayWidth ?? rangeDisplayWidth(input.rangeStart, input.rangeEnd),
        nextSequence,
        input.assignmentMethod,
        input.autoDrawEnabled,
        input.autoDrawDelaySeconds,
        input.printPreassignedLabel,
        input.labelTemplateId ?? null,
        input.autoAssignAbsenteesOnClose,
        input.deleteAbsenteeInfoOnReopen,
        input.useCandidatePhotos,
        input.enableBulkDraw,
        actorUserId,
      ],
    );
    return Number(result.insertId);
  }

  async upsertTimeRange(
    executor: SqlExecutor,
    settingId: number,
    range: PseudonymTimeRangeInput,
    rangeScheduleKey: string,
    nextSequence: number,
    actorUserId: number,
  ): Promise<void> {
    await executor.execute(
      `INSERT INTO pseudonym_time_range
        (setting_id, exam_date, exam_time, period_name, admission, unit_name, major,
         building_name, room_name, schedule_key, range_start, range_end, display_width, next_sequence, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         exam_date = VALUES(exam_date), exam_time = VALUES(exam_time), period_name = VALUES(period_name),
         admission = VALUES(admission), unit_name = VALUES(unit_name), major = VALUES(major),
         building_name = VALUES(building_name), room_name = VALUES(room_name),
         range_start = VALUES(range_start), range_end = VALUES(range_end), display_width = VALUES(display_width),
         next_sequence = VALUES(next_sequence), updated_by = VALUES(updated_by)`,
      [
        settingId,
        range.date,
        range.time,
        range.period,
        range.admission,
        range.unit,
        range.major,
        range.building,
        range.room,
        rangeScheduleKey,
        range.rangeStart,
        range.rangeEnd,
        range.displayWidth ?? rangeDisplayWidth(range.rangeStart, range.rangeEnd),
        nextSequence,
        actorUserId,
      ],
    );
  }

  async deleteTimeRange(executor: SqlExecutor, id: number): Promise<void> {
    await executor.execute("DELETE FROM pseudonym_time_range WHERE id = ?", [id]);
  }

  async findOperationStatus(
    executor: SqlExecutor,
    input: PseudonymOperationScopeInput,
  ): Promise<OperationStatusRow | undefined> {
    const [rows] = await executor.execute<OperationStatusRow[]>(
      `SELECT po.closed, po.closed_at AS closedAt, u.login_id AS closedByLoginId
       FROM pseudonym_operation po
       LEFT JOIN app_user u ON u.id = po.closed_by
       WHERE po.exam_name = ? AND po.exam_date = ? AND po.exam_time = ?
         AND po.period_name = ? AND po.admission_name = ? LIMIT 1`,
      operationParams(input),
    );
    return rows[0];
  }

  async listOperationRoster(
    executor: SqlExecutor,
    input: PseudonymOperationScopeInput,
    filters: PseudonymRosterFilterSpecification[],
  ): Promise<CanonicalPseudonymRosterRow[]> {
    const filter = buildOperationRosterFilterSql(filters);
    const [rows] = await executor.execute<OperationRosterRow[]>(
      `SELECT ${operationRosterSelectSql()}
       FROM candidate_record cr
       LEFT JOIN pseudonym_assignment pa ON pa.candidate_record_id = cr.id
       LEFT JOIN pseudonym_operation po
         ON po.exam_name = cr.exam_name AND po.exam_date = cr.exam_date AND po.exam_time = cr.start_time
        AND po.period_name = cr.period_name AND po.admission_name = cr.admission
       LEFT JOIN (
         SELECT candidate_record_id, MAX(sent_at) AS last_printed_at
         FROM print_job
         WHERE label_type = 'PSEUDONYM_LABEL' AND status = 'SENT' AND candidate_record_id IS NOT NULL
         GROUP BY candidate_record_id
       ) printed ON printed.candidate_record_id = cr.id
       WHERE cr.exam_name = ? AND cr.status = 'ACTIVE'
         AND cr.exam_date = ? AND cr.start_time = ? AND cr.period_name = ? AND cr.admission = ?${filter.sql}
       ORDER BY cr.designated_sort, cr.examinee_no
       LIMIT ${PSEUDONYM_ROSTER_EXPORT_MAX_ROWS + 1}`,
      [input.examName, input.examDate, input.examTime, input.periodName, input.admissionName, ...filter.parameters],
    );
    return rows;
  }

  async countAutoAssignedAbsentees(executor: SqlExecutor, input: PseudonymOperationScopeInput): Promise<number> {
    const [rows] = await executor.execute<Array<RowDataPacket & { autoAssignedAbsenteeCount: number }>>(
      `SELECT COUNT(*) AS autoAssignedAbsenteeCount
       FROM pseudonym_assignment pa
       INNER JOIN candidate_record cr ON cr.id = pa.candidate_record_id
       WHERE pa.auto_assigned_on_close = TRUE
         AND pa.exam_name = ? AND pa.admission_name = ?
         AND cr.exam_date = ? AND cr.start_time = ?
         AND cr.period_name = ? AND cr.admission = ?`,
      [input.examName, input.admissionName, input.examDate, input.examTime, input.periodName, input.admissionName],
    );
    return Number(rows[0]?.autoAssignedAbsenteeCount || 0);
  }

  async ensureOperation(executor: SqlExecutor, input: PseudonymOperationScopeInput): Promise<void> {
    await executor.execute(ensureOperationSql, operationParams(input));
  }

  async lockOperation(
    executor: SqlExecutor,
    input: PseudonymOperationScopeInput,
  ): Promise<OperationLockRow | undefined> {
    const [rows] = await executor.execute<Array<RowDataPacket & OperationLockRow>>(
      lockOperationSql,
      operationParams(input),
    );
    return rows[0];
  }

  async findOperationForUpdate(
    executor: SqlExecutor,
    input: PseudonymOperationScopeInput,
  ): Promise<OperationLockRow | undefined> {
    const [rows] = await executor.execute<Array<RowDataPacket & OperationLockRow>>(
      `SELECT id, closed FROM pseudonym_operation
       WHERE exam_name = ? AND exam_date = ? AND exam_time = ?
         AND period_name = ? AND admission_name = ? LIMIT 1 FOR UPDATE`,
      operationParams(input),
    );
    return rows[0];
  }

  async listUnassignedCandidatesForUpdate(
    executor: SqlExecutor,
    input: PseudonymOperationScopeInput,
    excludePreassigned = false,
  ): Promise<CandidateRow[]> {
    const [rows] = await executor.execute<CandidateRow[]>(
      `SELECT cr.id, cr.id AS candidateRecordId, cr.examinee_no AS examineeNo, cr.name, cr.exam_name AS examName,
              NULLIF(cr.temporary_no, '') AS preassignedNumber,
              DATE_FORMAT(cr.exam_date, '%Y-%m-%d') AS examDate, cr.start_time AS examTime,
              cr.period_name AS period, cr.admission, cr.unit_name AS unit, cr.major,
              cr.building_name AS building, cr.room_name AS room
       FROM candidate_record cr
       LEFT JOIN pseudonym_assignment pa ON pa.candidate_record_id = cr.id
       WHERE cr.exam_name = ? AND cr.status = 'ACTIVE' AND cr.exam_date = ? AND cr.start_time = ? AND cr.period_name = ?
          AND cr.admission = ? AND pa.id IS NULL${excludePreassigned ? " AND NULLIF(cr.temporary_no, '') IS NULL" : ""}
       ORDER BY cr.designated_sort, cr.examinee_no FOR UPDATE`,
      [input.examName, input.examDate, input.examTime, input.periodName, input.admissionName],
    );
    return rows;
  }

  async insertAbsenteeAssignment(
    executor: SqlExecutor,
    candidate: CandidateRow,
    admissionName: string,
    uniquenessScopeKey: string,
    pseudonymNumber: string,
    assignmentMode: PseudonymAssignmentMode,
    actorUserId: number,
  ): Promise<number> {
    const [result] = await executor.execute<ResultSetHeader>(
      `INSERT INTO pseudonym_assignment
        (candidate_record_id, exam_name, admission_name, uniqueness_scope_key,
         pseudonym_no, assignment_mode, is_absentee, auto_assigned_on_close, assigned_by)
       VALUES (?, ?, ?, ?, ?, ?, TRUE, TRUE, ?)`,
      [
        candidate.candidateRecordId,
        candidate.examName,
        admissionName,
        uniquenessScopeKey,
        pseudonymNumber,
        assignmentMode,
        actorUserId,
      ],
    );
    return result.insertId;
  }

  async closeOperation(executor: SqlExecutor, operationId: number, actorUserId: number): Promise<void> {
    await executor.execute(
      `UPDATE pseudonym_operation
       SET closed = TRUE, closed_by = ?, closed_at = CURRENT_TIMESTAMP(3), reopened_by = NULL, reopened_at = NULL
       WHERE id = ?`,
      [actorUserId, operationId],
    );
  }

  async deleteAutoAssignedAbsentees(executor: SqlExecutor, input: PseudonymOperationScopeInput): Promise<number> {
    const [result] = await executor.execute<ResultSetHeader>(
      `DELETE pa FROM pseudonym_assignment pa
       INNER JOIN candidate_record cr ON cr.id = pa.candidate_record_id
       WHERE pa.auto_assigned_on_close = TRUE
         AND pa.exam_name = ? AND pa.admission_name = ?
         AND cr.exam_date = ? AND cr.start_time = ?
         AND cr.period_name = ? AND cr.admission = ?`,
      [input.examName, input.admissionName, input.examDate, input.examTime, input.periodName, input.admissionName],
    );
    return result.affectedRows;
  }

  async listAutoAssignedAbsenteeIdsForUpdate(
    executor: SqlExecutor,
    input: PseudonymOperationScopeInput,
  ): Promise<number[]> {
    const [rows] = await executor.execute<IdRow[]>(
      `SELECT pa.id
       FROM pseudonym_assignment pa
       INNER JOIN candidate_record cr ON cr.id = pa.candidate_record_id
       WHERE pa.auto_assigned_on_close = TRUE
         AND pa.exam_name = ? AND pa.admission_name = ?
         AND cr.exam_date = ? AND cr.start_time = ?
         AND cr.period_name = ? AND cr.admission = ?
       ORDER BY pa.id FOR UPDATE`,
      [input.examName, input.admissionName, input.examDate, input.examTime, input.periodName, input.admissionName],
    );
    return rows.map((row) => Number(row.id));
  }

  async reopenOperation(executor: SqlExecutor, operationId: number, actorUserId: number): Promise<void> {
    await executor.execute(
      `UPDATE pseudonym_operation
       SET closed = FALSE, reopened_by = ?, reopened_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [actorUserId, operationId],
    );
  }

  async findCandidateInScope(
    executor: SqlExecutor,
    input: AssignPseudonymInput,
    options: { forUpdate: boolean },
  ): Promise<CandidateRow | undefined> {
    const [rows] = await executor.execute<CandidateRow[]>(
      `SELECT cr.id, cr.id AS candidateRecordId, cr.examinee_no AS examineeNo, cr.name,
              COALESCE(NULLIF(?, ''), cr.exam_name) AS examName,
              NULLIF(cr.temporary_no, '') AS preassignedNumber,
              DATE_FORMAT(cr.exam_date, '%Y-%m-%d') AS examDate, cr.start_time AS examTime,
              cr.period_name AS period, cr.admission, cr.unit_name AS unit, cr.major,
              cr.building_name AS building, cr.room_name AS room
       FROM candidate_record cr
       WHERE cr.examinee_no = ? AND cr.exam_date = ? AND cr.start_time = ?
         AND cr.period_name = ? AND cr.admission = ? AND cr.status = 'ACTIVE'
       LIMIT 1${options.forUpdate ? " FOR UPDATE" : ""}`,
      [
        input.examName?.trim() || "",
        input.examineeNo.trim(),
        input.examDate,
        input.examTime,
        input.periodName,
        input.admissionName,
      ],
    );
    return rows[0];
  }

  async findAssignmentForUpdate(executor: SqlExecutor, candidateRecordId: number): Promise<AssignmentData | undefined> {
    const [rows] = await executor.execute<AssignmentRow[]>(
      `SELECT id, pseudonym_no AS pseudonymNumber, assignment_mode AS mode, assigned_at AS assignedAt
       FROM pseudonym_assignment WHERE candidate_record_id = ? LIMIT 1 FOR UPDATE`,
      [candidateRecordId],
    );
    return rows[0];
  }

  async updateTimeRangeSequence(
    executor: SqlExecutor,
    timeRangeId: number,
    nextSequence: number,
    actorUserId: number,
  ): Promise<void> {
    await executor.execute("UPDATE pseudonym_time_range SET next_sequence = ?, updated_by = ? WHERE id = ?", [
      nextSequence,
      actorUserId,
      timeRangeId,
    ]);
  }

  async updateSettingSequence(
    executor: SqlExecutor,
    settingId: number,
    nextSequence: number,
    actorUserId: number,
  ): Promise<void> {
    await executor.execute("UPDATE pseudonym_setting SET next_sequence = ?, updated_by = ? WHERE id = ?", [
      nextSequence,
      actorUserId,
      settingId,
    ]);
  }

  async insertAssignment(
    executor: SqlExecutor,
    candidate: CandidateRow,
    admissionName: string,
    uniquenessScopeKey: string,
    pseudonymNumber: string,
    assignmentMode: PseudonymAssignmentMode,
    actorUserId: number,
  ): Promise<number> {
    const [result] = await executor.execute<ResultSetHeader>(
      `INSERT INTO pseudonym_assignment
        (candidate_record_id, exam_name, admission_name, uniqueness_scope_key,
         pseudonym_no, assignment_mode, assigned_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        candidate.candidateRecordId,
        candidate.examName,
        admissionName,
        uniquenessScopeKey,
        pseudonymNumber,
        assignmentMode,
        actorUserId,
      ],
    );
    return result.insertId;
  }

  async loadPseudonymNumberPolicyForUpdate(executor: SqlExecutor): Promise<PseudonymNoUniqueness> {
    const [rows] = await executor.execute<PseudonymPolicyRow[]>(
      `SELECT pseudonym_no_uniqueness AS pseudonymNoUniqueness
       FROM system_profile WHERE id = 1 LIMIT 1 FOR UPDATE`,
    );
    return rows[0]?.pseudonymNoUniqueness ?? "ADMISSION";
  }

  async loadReservedNumbers(
    executor: SqlExecutor,
    examName: string,
    admissionName: string,
    policy: PseudonymNoUniqueness,
    scope: PseudonymScheduleScope,
  ): Promise<Set<number>> {
    const scopeKey = pseudonymUniquenessScopeKey(policy, scope);
    const [rows] = await executor.execute<NumberRow[]>(
      `SELECT pseudonym_no AS pseudonymNumber
       FROM pseudonym_assignment
       WHERE exam_name = ? AND admission_name = ?
         AND (
           uniqueness_scope_key = ?
           OR (? = 'SCHEDULE' AND candidate_record_id IS NULL AND uniqueness_scope_key = '')
         )
       UNION
       SELECT NULLIF(cr.temporary_no, '') AS pseudonymNumber
       FROM candidate_record cr
       WHERE cr.exam_name = ? AND cr.admission = ? AND cr.temporary_no <> ''
         AND (? = 'ADMISSION' OR (
           cr.exam_date = ? AND cr.start_time = ? AND cr.period_name = ?
         ))
         AND EXISTS (
           SELECT 1 FROM candidate_record active_candidate
           WHERE active_candidate.id = cr.id AND active_candidate.status = 'ACTIVE'
         )`,
      [
        examName,
        admissionName,
        scopeKey,
        policy,
        examName,
        admissionName,
        policy,
        scope.date,
        scope.time,
        scope.period,
      ],
    );
    return new Set(rows.map((row) => parsePseudonym(row.pseudonymNumber)));
  }

  async findPreassignedOwner(
    executor: SqlExecutor,
    examName: string,
    admissionName: string,
    number: string,
    policy: PseudonymNoUniqueness,
    scope: PseudonymScheduleScope,
  ): Promise<number | null> {
    const [rows] = await executor.execute<Array<RowDataPacket & { candidateRecordId: number }>>(
      `SELECT cr.id AS candidateRecordId
       FROM candidate_record cr
       WHERE cr.exam_name = ? AND cr.admission = ? AND cr.temporary_no = ?
         AND (? = 'ADMISSION' OR (
           cr.exam_date = ? AND cr.start_time = ? AND cr.period_name = ?
         ))
         AND EXISTS (
           SELECT 1 FROM candidate_record active_candidate
           WHERE active_candidate.id = cr.id AND active_candidate.status = 'ACTIVE'
         )
       ORDER BY cr.id LIMIT 1`,
      [examName, admissionName, number, policy, scope.date, scope.time, scope.period],
    );
    return rows[0]?.candidateRecordId ?? null;
  }
}

const settingSelectSql = `SELECT id, version, exam_name AS examName, admission_name AS admissionName, range_start AS rangeStart, range_end AS rangeEnd,
  display_width AS displayWidth,
  next_sequence AS nextSequence, assignment_method AS assignmentMethod,
  auto_draw_enabled AS autoDrawEnabled, auto_draw_delay_seconds AS autoDrawDelaySeconds,
  print_preassigned_label AS printPreassignedLabel,
  label_template_id AS labelTemplateId,
  auto_assign_absentees_on_close AS autoAssignAbsenteesOnClose,
  delete_absentee_info_on_reopen AS deleteAbsenteeInfoOnReopen,
  use_candidate_photos AS useCandidatePhotos, enable_bulk_draw AS enableBulkDraw
  FROM pseudonym_setting`;

const ensureOperationSql = `INSERT IGNORE INTO pseudonym_operation
  (exam_name, exam_date, exam_time, period_name, admission_name, closed)
 VALUES (?, ?, ?, ?, ?, FALSE)`;

const lockOperationSql = `SELECT id, closed FROM pseudonym_operation
 WHERE exam_name = ? AND exam_date = ? AND exam_time = ?
   AND period_name = ? AND admission_name = ? LIMIT 1 FOR UPDATE`;

function operationParams(input: PseudonymOperationScopeInput) {
  return [input.examName, input.examDate, input.examTime, input.periodName, input.admissionName];
}

const historyCandidatePredicate =
  "cr.exam_name = ? AND cr.admission = ? AND cr.exam_date = ? AND cr.start_time = ? AND cr.period_name = ?";
function historyScopeParams(scope: PseudonymOperationScopeInput) {
  return [scope.examName, scope.admissionName, scope.examDate, scope.examTime, scope.periodName];
}

function rangeDisplayWidth(start: number, end: number) {
  return Math.max(String(start).length, String(end).length);
}

function scheduleSelectionSql(
  alias: string,
  schedules: readonly AdmissionOperationScheduleInput[],
  columns: { date: string; time: string; period: string } = {
    date: "exam_date",
    time: "start_time",
    period: "period_name",
  },
) {
  const sql = schedules
    .map(() => `(${alias}.${columns.date} = ? AND ${alias}.${columns.time} = ? AND ${alias}.${columns.period} = ?)`)
    .join(" OR ");
  const parameters = schedules.flatMap((schedule) => [schedule.examDate, schedule.examTime, schedule.periodName]);
  return { sql, parameters };
}
