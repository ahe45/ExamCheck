import { Injectable } from "@nestjs/common";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import {
  admissionPolicyScopeKey,
  candidateClaimOwnerKey,
  candidateScheduleScopeKey,
  candidateSystemScopeKey,
  cycleCodeForAcademicYear,
  defaultPolicyScopeKey,
  parseCanonicalPseudonymNumber,
  pseudonymAdmissionScopeKey,
  pseudonymScheduleScopeKey,
} from "../identity-transition/identity-keys.js";
import { normalizeIdentityText } from "../identity-transition/identity-normalization.js";
import type { SafeIssueDetails } from "./identity-backfill.types.js";

export class IdentityBackfillProjectionError extends Error {
  constructor(
    readonly code: string,
    readonly entityType: string,
    readonly sourceId: number,
    readonly details: SafeIssueDetails = {},
  ) {
    super(`Identity backfill projection failed: ${code}`);
    this.name = "IdentityBackfillProjectionError";
  }
}

interface SystemProfileRow extends RowDataPacket {
  academicYear: number;
  updatedBy: number | null;
  examineeScope: "SYSTEM" | "SCHEDULE";
  pseudonymScope: "ADMISSION" | "SCHEDULE";
}

interface LegacySettingRow extends RowDataPacket {
  id: number;
  admissionName: string;
  assignmentMethod: "DRAW" | "SEQUENTIAL" | "MATCHING" | "PREASSIGNED";
  autoDrawEnabled: number | boolean;
  autoDrawDelaySeconds: number;
  printPreassignedLabel: number | boolean;
  autoAssignAbsenteesOnClose: number | boolean;
  deleteAbsenteeInfoOnReopen: number | boolean;
  useCandidatePhotos: number | boolean;
  enableBulkDraw: number | boolean;
  version: number;
  updatedBy: number;
}

interface ExistingPolicyRow extends RowDataPacket {
  id: number;
  sourceSettingId: number | null;
}

interface LegacyRangeRow extends RowDataPacket {
  id: number;
  settingId: number;
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
  displayWidth: number;
  nextSequence: number;
  updatedBy: number;
}

interface IdRow extends RowDataPacket {
  id: number;
}

interface SourceIdRow extends RowDataPacket {
  id: number;
  sourceId: number | null;
}

interface LegacyOperationRow extends RowDataPacket {
  id: number;
  examDate: string;
  examTime: string;
  periodName: string;
  admissionName: string;
  closed: number | boolean;
  closedBy: number | null;
  closedAt: Date | string | null;
  reopenedBy: number | null;
  reopenedAt: Date | string | null;
}

interface LegacyAssignmentRow extends RowDataPacket {
  id: number;
  candidateRecordId: number | null;
  admissionName: string;
  pseudonymNo: string;
  assignmentMode: "RANDOM" | "SEQUENTIAL" | "MANUAL" | "PREASSIGNED";
  isAbsentee: number | boolean;
  autoAssignedOnClose: number | boolean;
  assignedBy: number;
  assignedAt: Date | string;
}

interface AssignmentContextRow extends RowDataPacket {
  registrationId: number;
  operationSlotId: number;
  admissionId: number;
  examCycleId: number;
  pseudonymScope: "ADMISSION" | "SCHEDULE";
}

interface ExistingAssignmentRow extends RowDataPacket {
  id: number;
  registrationId: number;
  sourceAssignmentId: number | null;
}

interface LegacyReservationRow extends RowDataPacket {
  examCycleId: number;
  admissionId: number | null;
  scopeKey: Buffer;
  pseudonymValue: number;
}

interface LegacyAccountRow extends RowDataPacket {
  id: number;
  role: "ADMIN" | "OPERATOR" | "VIEWER" | "DEVELOPER";
}

interface AdmissionNameRow extends RowDataPacket {
  admissionName: string;
}

interface CurrentAssignmentRemovalRow extends RowDataPacket {
  id: number;
  registrationId: number;
  operationId: number;
  pseudonymValue: number;
  displayWidth: number;
  assignmentMode: "RANDOM" | "SEQUENTIAL" | "MANUAL" | "PREASSIGNED";
}

interface CandidateClaimProjectionRow extends RowDataPacket {
  candidateId: number;
  registrationId: number;
  operationSlotId: number;
  examineeNoCanonical: string;
}

interface PseudonymClaimProjectionRow extends RowDataPacket {
  assignmentId: number;
  sourceAssignmentId: number;
  admissionId: number;
  operationSlotId: number;
  pseudonymValue: number;
}

export interface AssignmentProjectionResult {
  kind: "EXACT" | "LEGACY_RESERVATION";
}

export interface IdentityOperationEventMetrics {
  autoAssignedAbsenteeCount?: number;
  removedCurrentAbsenteeCount?: number;
}

@Injectable()
export class IdentityBackfillProjectionRepository {
  async syncSettingTree(executor: SqlExecutor, sourceSettingId: number, examName: string): Promise<void> {
    const examCycleId = await this.ensureExamCycle(executor, examName);
    await this.syncSetting(executor, sourceSettingId, examCycleId);
    const [ranges] = await executor.execute<IdRow[]>(
      `SELECT id FROM pseudonym_time_range WHERE setting_id = ? ORDER BY id FOR UPDATE`,
      [sourceSettingId],
    );
    for (const range of ranges) await this.syncRange(executor, Number(range.id));
    await executor.execute(
      `DELETE target_range FROM pseudonym_range target_range
       INNER JOIN pseudonym_policy policy ON policy.id = target_range.pseudonym_policy_id
       LEFT JOIN pseudonym_time_range source_range
         ON source_range.id = target_range.source_time_range_id
       WHERE policy.source_setting_id = ?
         AND target_range.source_time_range_id IS NOT NULL
         AND source_range.id IS NULL`,
      [sourceSettingId],
    );
  }

  async syncOperationTree(
    executor: SqlExecutor,
    sourceOperationId: number,
    examName: string,
    eventMetrics: IdentityOperationEventMetrics = {},
  ): Promise<void> {
    const examCycleId = await this.ensureExamCycle(executor, examName);
    await this.syncOperation(executor, sourceOperationId, examCycleId, eventMetrics);
  }

  async syncAssignmentTree(executor: SqlExecutor, sourceAssignmentId: number, examName: string): Promise<void> {
    const examCycleId = await this.ensureExamCycle(executor, examName);
    await this.syncAssignment(executor, sourceAssignmentId, examCycleId);
  }

  async syncAccountForCurrentCycle(executor: SqlExecutor, sourceUserId: number): Promise<void> {
    const examCycleId = await this.loadCurrentExamCycleId(executor);
    await this.syncAccount(executor, sourceUserId, examCycleId);
  }

  async assertAcademicYearChangeAllowed(executor: SqlExecutor, nextAcademicYear: number): Promise<void> {
    const [rows] = await executor.query<Array<RowDataPacket & { academicYear: number; registrationCount: number }>>(
      `SELECT cycle.academic_year AS academicYear,
              COUNT(registration.id) AS registrationCount
       FROM exam_cycle cycle
       LEFT JOIN candidate candidate_identity ON candidate_identity.exam_cycle_id = cycle.id
       LEFT JOIN candidate_registration registration ON registration.candidate_id = candidate_identity.id
       WHERE cycle.system_profile_id = 1 AND cycle.status = 'ACTIVE'
       GROUP BY cycle.id, cycle.academic_year
       ORDER BY cycle.id DESC LIMIT 2 FOR UPDATE`,
    );
    if (rows.length > 1)
      throw new Error("Multiple active identity exam cycles must be resolved before profile changes.");
    const active = rows[0];
    if (active && Number(active.academicYear) !== nextAcademicYear) {
      throw new Error(
        "Academic year changes require the approved exam-cycle transition procedure while target identity writes are enabled.",
      );
    }
  }

  async syncCurrentNumberPolicyAndClaims(executor: SqlExecutor, updatedBy: number): Promise<void> {
    const examCycleId = await this.loadCurrentExamCycleId(executor);
    const [profiles] = await executor.query<SystemProfileRow[]>(
      `SELECT academic_year AS academicYear, updated_by AS updatedBy,
              examinee_no_uniqueness AS examineeScope,
              pseudonym_no_uniqueness AS pseudonymScope
       FROM system_profile WHERE id = 1 LIMIT 1 LOCK IN SHARE MODE`,
    );
    const profile = profiles[0];
    if (!profile) throw new Error("System profile is missing.");
    await executor.execute(
      `INSERT INTO number_uniqueness_policy
        (exam_cycle_id, examinee_scope, pseudonym_scope, updated_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE examinee_scope = VALUES(examinee_scope),
         pseudonym_scope = VALUES(pseudonym_scope), updated_by = VALUES(updated_by),
         version = version + 1`,
      [examCycleId, profile.examineeScope, profile.pseudonymScope, updatedBy],
    );

    await executor.execute(
      `DELETE claim FROM candidate_number_claim claim
       INNER JOIN candidate candidate_identity ON candidate_identity.id = claim.candidate_id
       WHERE candidate_identity.exam_cycle_id = ?`,
      [examCycleId],
    );
    const [candidateRows] = await executor.execute<CandidateClaimProjectionRow[]>(
      `SELECT candidate_identity.id AS candidateId, registration.id AS registrationId,
              slot.id AS operationSlotId,
              candidate_identity.examinee_no_canonical AS examineeNoCanonical
       FROM candidate_registration registration
       INNER JOIN candidate candidate_identity ON candidate_identity.id = registration.candidate_id
       INNER JOIN schedule_segment segment ON segment.id = registration.schedule_segment_id
       INNER JOIN operation_slot slot ON slot.id = segment.operation_slot_id
       WHERE candidate_identity.exam_cycle_id = ? AND registration.status = 'ACTIVE'
       ORDER BY candidate_identity.id, registration.id FOR UPDATE`,
      [examCycleId],
    );
    const insertedSystemCandidates = new Set<number>();
    for (const row of candidateRows) {
      const scheduleScoped = profile.examineeScope === "SCHEDULE";
      if (!scheduleScoped && insertedSystemCandidates.has(Number(row.candidateId))) continue;
      insertedSystemCandidates.add(Number(row.candidateId));
      const scopeKey = scheduleScoped
        ? candidateScheduleScopeKey(Number(row.operationSlotId))
        : candidateSystemScopeKey(examCycleId);
      const ownerKey = candidateClaimOwnerKey({
        scopeKind: profile.examineeScope,
        candidateId: Number(row.candidateId),
        ...(scheduleScoped ? { registrationId: Number(row.registrationId) } : {}),
      });
      await executor.execute(
        `INSERT INTO candidate_number_claim
          (candidate_id, registration_id, scope_kind, exam_cycle_id, operation_slot_id,
           scope_key, owner_key, examinee_no_canonical)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.candidateId,
          scheduleScoped ? row.registrationId : null,
          profile.examineeScope,
          examCycleId,
          scheduleScoped ? row.operationSlotId : null,
          scopeKey,
          ownerKey,
          row.examineeNoCanonical,
        ],
      );
    }

    await executor.execute(
      `DELETE claim FROM pseudonym_number_claim claim
       INNER JOIN candidate_pseudonym_assignment assignment ON assignment.id = claim.assignment_id
       INNER JOIN candidate_registration registration ON registration.id = assignment.registration_id
       INNER JOIN candidate candidate_identity ON candidate_identity.id = registration.candidate_id
       WHERE candidate_identity.exam_cycle_id = ?`,
      [examCycleId],
    );
    const [assignmentRows] = await executor.execute<PseudonymClaimProjectionRow[]>(
      `SELECT assignment.id AS assignmentId,
              assignment.source_assignment_id AS sourceAssignmentId,
              admission.id AS admissionId, slot.id AS operationSlotId,
              assignment.pseudonym_value AS pseudonymValue
       FROM candidate_pseudonym_assignment assignment
       INNER JOIN candidate_registration registration ON registration.id = assignment.registration_id
       INNER JOIN candidate candidate_identity ON candidate_identity.id = registration.candidate_id
       INNER JOIN schedule_segment segment ON segment.id = registration.schedule_segment_id
       INNER JOIN operation_slot slot ON slot.id = segment.operation_slot_id
       INNER JOIN admission ON admission.id = slot.admission_id
       WHERE candidate_identity.exam_cycle_id = ?
       ORDER BY assignment.id FOR UPDATE`,
      [examCycleId],
    );
    for (const row of assignmentRows) {
      await this.ensurePseudonymClaim(executor, {
        assignmentId: Number(row.assignmentId),
        admissionId: Number(row.admissionId),
        operationSlotId: Number(row.operationSlotId),
        pseudonymScope: profile.pseudonymScope,
        pseudonymValue: Number(row.pseudonymValue),
        sourceAssignmentId: Number(row.sourceAssignmentId),
      });
    }
  }

  async clearAccountScope(executor: SqlExecutor, sourceUserId: number): Promise<void> {
    await executor.execute(`DELETE FROM user_admission_scope_assignment WHERE user_id = ?`, [sourceUserId]);
    await executor.execute(`UPDATE app_user SET admission_scope_mode = NULL WHERE id = ?`, [sourceUserId]);
  }

  async removeCurrentAssignments(
    executor: SqlExecutor,
    sourceAssignmentIds: readonly number[],
    actorUserId: number,
  ): Promise<void> {
    if (!sourceAssignmentIds.length) return;
    const placeholders = sourceAssignmentIds.map(() => "?").join(", ");
    const [rows] = await executor.execute<CurrentAssignmentRemovalRow[]>(
      `SELECT assignment.id, assignment.registration_id AS registrationId,
              assignment.pseudonym_operation_id AS operationId,
              assignment.pseudonym_value AS pseudonymValue,
              assignment.display_width AS displayWidth,
              assignment.assignment_mode AS assignmentMode
       FROM candidate_pseudonym_assignment assignment
       WHERE assignment.source_assignment_id IN (${placeholders})
       ORDER BY assignment.id FOR UPDATE`,
      [...sourceAssignmentIds],
    );
    for (const row of rows) {
      const [events] = await executor.execute<IdRow[]>(
        `SELECT id FROM pseudonym_assignment_event
         WHERE assignment_id = ? AND event_type = 'CURRENT_REMOVED_ON_REOPEN'
         LIMIT 1`,
        [row.id],
      );
      if (!events[0]) {
        await executor.execute(
          `INSERT INTO pseudonym_assignment_event
            (assignment_id, registration_id, operation_id, event_type,
             pseudonym_value, display_width, assignment_mode, actor_user_id)
           VALUES (?, ?, ?, 'CURRENT_REMOVED_ON_REOPEN', ?, ?, ?, ?)`,
          [
            row.id,
            row.registrationId,
            row.operationId,
            row.pseudonymValue,
            row.displayWidth,
            row.assignmentMode,
            actorUserId,
          ],
        );
      }
      await executor.execute(`DELETE FROM candidate_pseudonym_assignment WHERE id = ?`, [row.id]);
    }
  }

  async ensureExamCycle(executor: SqlExecutor, examName: string): Promise<number> {
    const [profiles] = await executor.query<SystemProfileRow[]>(
      `SELECT academic_year AS academicYear, updated_by AS updatedBy,
              examinee_no_uniqueness AS examineeScope,
              pseudonym_no_uniqueness AS pseudonymScope
       FROM system_profile WHERE id = 1 LIMIT 1 LOCK IN SHARE MODE`,
    );
    const profile = profiles[0];
    if (!profile) throw new Error("System profile is missing.");
    const [result] = await executor.execute<ResultSetHeader>(
      `INSERT INTO exam_cycle
        (system_profile_id, cycle_code, display_name, academic_year, status, created_by, updated_by)
       VALUES (1, ?, ?, ?, 'ACTIVE', ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), display_name = VALUES(display_name),
         academic_year = VALUES(academic_year), status = 'ACTIVE', updated_by = VALUES(updated_by)`,
      [
        cycleCodeForAcademicYear(Number(profile.academicYear)),
        normalizeRequired(examName, "Exam name"),
        Number(profile.academicYear),
        profile.updatedBy,
        profile.updatedBy,
      ],
    );
    const cycleId = requiredInsertId(result, "exam cycle");
    await executor.execute(
      `INSERT INTO number_uniqueness_policy
        (exam_cycle_id, examinee_scope, pseudonym_scope, updated_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE examinee_scope = VALUES(examinee_scope),
         pseudonym_scope = VALUES(pseudonym_scope), updated_by = VALUES(updated_by)`,
      [cycleId, profile.examineeScope, profile.pseudonymScope, profile.updatedBy],
    );
    return cycleId;
  }

  private async loadCurrentExamCycleId(executor: SqlExecutor): Promise<number> {
    const [rows] = await executor.query<IdRow[]>(
      `SELECT cycle.id
       FROM exam_cycle cycle
       INNER JOIN system_profile profile
         ON profile.id = cycle.system_profile_id AND profile.academic_year = cycle.academic_year
       WHERE cycle.system_profile_id = 1 AND cycle.status = 'ACTIVE'
       ORDER BY cycle.id DESC LIMIT 2 LOCK IN SHARE MODE`,
    );
    if (rows.length !== 1) {
      throw new Error("Exactly one active identity exam cycle is required for account scope writes.");
    }
    return Number(rows[0]?.id);
  }

  async syncSetting(executor: SqlExecutor, sourceSettingId: number, examCycleId: number): Promise<void> {
    const [rows] = await executor.execute<LegacySettingRow[]>(
      `SELECT id, admission_name AS admissionName, assignment_method AS assignmentMethod,
              auto_draw_enabled AS autoDrawEnabled, auto_draw_delay_seconds AS autoDrawDelaySeconds,
              print_preassigned_label AS printPreassignedLabel,
              auto_assign_absentees_on_close AS autoAssignAbsenteesOnClose,
              delete_absentee_info_on_reopen AS deleteAbsenteeInfoOnReopen,
              use_candidate_photos AS useCandidatePhotos,
              enable_bulk_draw AS enableBulkDraw, version, updated_by AS updatedBy
       FROM pseudonym_setting WHERE id = ? LIMIT 1 FOR UPDATE`,
      [sourceSettingId],
    );
    const source = rows[0];
    if (!source) {
      throw new IdentityBackfillProjectionError("SOURCE_SETTING_NOT_FOUND", "pseudonym_setting", sourceSettingId);
    }
    const admissionName = normalizeIdentityText(source.admissionName);
    const admissionId = admissionName
      ? await this.resolveAdmissionByName(executor, examCycleId, admissionName, "pseudonym_setting", source.id)
      : null;
    const scopeKind = admissionId === null ? "DEFAULT" : "ADMISSION";
    const scopeKey = admissionId === null ? defaultPolicyScopeKey(examCycleId) : admissionPolicyScopeKey(admissionId);
    const [existingRows] = await executor.execute<ExistingPolicyRow[]>(
      `SELECT id, source_setting_id AS sourceSettingId
       FROM pseudonym_policy WHERE scope_key = ? LIMIT 1 FOR UPDATE`,
      [scopeKey],
    );
    const existing = existingRows[0];
    if (existing && existing.sourceSettingId !== null && Number(existing.sourceSettingId) !== source.id) {
      throw new IdentityBackfillProjectionError("POLICY_SCOPE_CONFLICT", "pseudonym_setting", source.id, {
        policyId: Number(existing.id),
      });
    }
    const delay = Number(source.autoDrawDelaySeconds);
    if (!Number.isInteger(delay) || delay < 0 || delay > 65_535) {
      throw new IdentityBackfillProjectionError("POLICY_DELAY_OUT_OF_RANGE", "pseudonym_setting", source.id);
    }
    const values = [
      examCycleId,
      scopeKind,
      admissionId,
      scopeKey,
      source.id,
      source.assignmentMethod,
      Boolean(source.autoDrawEnabled),
      delay,
      Boolean(source.printPreassignedLabel),
      Boolean(source.autoAssignAbsenteesOnClose),
      Boolean(source.deleteAbsenteeInfoOnReopen),
      Boolean(source.useCandidatePhotos),
      Boolean(source.enableBulkDraw),
      Math.max(1, Number(source.version)),
      source.updatedBy,
    ];
    if (existing) {
      await executor.execute(
        `UPDATE pseudonym_policy
         SET exam_cycle_id = ?, scope_kind = ?, admission_id = ?, scope_key = ?, source_setting_id = ?,
             assignment_method = ?, auto_draw_enabled = ?, auto_draw_delay_seconds = ?,
             print_preassigned_label = ?, auto_assign_absentees_on_close = ?,
             delete_absentee_info_on_reopen = ?, use_candidate_photos = ?, enable_bulk_draw = ?,
             version = ?, updated_by = ?
         WHERE id = ?`,
        [...values, existing.id],
      );
      return;
    }
    try {
      await executor.execute(
        `INSERT INTO pseudonym_policy
          (exam_cycle_id, scope_kind, admission_id, scope_key, source_setting_id,
           assignment_method, auto_draw_enabled, auto_draw_delay_seconds,
           print_preassigned_label, auto_assign_absentees_on_close,
           delete_absentee_info_on_reopen, use_candidate_photos, enable_bulk_draw,
           version, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values,
      );
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new IdentityBackfillProjectionError("POLICY_SOURCE_CONFLICT", "pseudonym_setting", source.id);
      }
      throw error;
    }
  }

  async syncRange(executor: SqlExecutor, sourceRangeId: number): Promise<void> {
    const [rows] = await executor.execute<LegacyRangeRow[]>(
      `SELECT ptr.id, ptr.setting_id AS settingId,
              COALESCE(NULLIF(ptr.admission, ''), ps.admission_name) AS admissionName,
              DATE_FORMAT(ptr.exam_date, '%Y-%m-%d') AS examDate,
              ptr.exam_time AS examTime, ptr.period_name AS periodName,
              ptr.unit_name AS unitName, ptr.major AS majorName,
              ptr.building_name AS buildingName, ptr.room_name AS roomName,
              ptr.range_start AS rangeStart, ptr.range_end AS rangeEnd, ptr.display_width AS displayWidth,
              ptr.next_sequence AS nextSequence, ptr.updated_by AS updatedBy
       FROM pseudonym_time_range ptr
       INNER JOIN pseudonym_setting ps ON ps.id = ptr.setting_id
       WHERE ptr.id = ? LIMIT 1 FOR UPDATE`,
      [sourceRangeId],
    );
    const source = rows[0];
    if (!source)
      throw new IdentityBackfillProjectionError("SOURCE_RANGE_NOT_FOUND", "pseudonym_time_range", sourceRangeId);
    const [policies] = await executor.execute<IdRow[]>(
      `SELECT id FROM pseudonym_policy WHERE source_setting_id = ? LIMIT 1 FOR UPDATE`,
      [source.settingId],
    );
    const policyId = Number(policies[0]?.id ?? 0);
    if (!policyId) {
      throw new IdentityBackfillProjectionError("RANGE_POLICY_UNMAPPED", "pseudonym_time_range", source.id, {
        sourceSettingId: source.settingId,
      });
    }
    const segmentId = await this.resolveRangeSegment(executor, source);
    const start = Number(source.rangeStart);
    const end = Number(source.rangeEnd);
    const next = Number(source.nextSequence);
    if (!isPositiveSafeInteger(start) || !isPositiveSafeInteger(end) || start > end) {
      throw new IdentityBackfillProjectionError("RANGE_VALUE_INVALID", "pseudonym_time_range", source.id);
    }
    if (!Number.isSafeInteger(next) || next < start || next > end + 1) {
      throw new IdentityBackfillProjectionError("RANGE_NEXT_OUT_OF_BOUNDS", "pseudonym_time_range", source.id);
    }
    const displayWidth = Math.max(Number(source.displayWidth), String(start).length, String(end).length);
    const [existingRows] = await executor.execute<SourceIdRow[]>(
      `SELECT id, source_time_range_id AS sourceId
       FROM pseudonym_range
       WHERE pseudonym_policy_id = ? AND schedule_segment_id = ?
       LIMIT 1 FOR UPDATE`,
      [policyId, segmentId],
    );
    const existing = existingRows[0];
    if (existing && existing.sourceId !== null && Number(existing.sourceId) !== source.id) {
      throw new IdentityBackfillProjectionError("RANGE_SEGMENT_CONFLICT", "pseudonym_time_range", source.id, {
        pseudonymRangeId: Number(existing.id),
      });
    }
    if (existing) {
      await executor.execute(
        `UPDATE pseudonym_range
         SET source_time_range_id = ?, range_start_value = ?, range_end_value = ?,
             next_value = ?, display_width = ?, updated_by = ?
         WHERE id = ?`,
        [source.id, start, end, next, displayWidth, source.updatedBy, existing.id],
      );
      return;
    }
    try {
      await executor.execute(
        `INSERT INTO pseudonym_range
          (pseudonym_policy_id, schedule_segment_id, source_time_range_id,
           range_start_value, range_end_value, next_value, display_width, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [policyId, segmentId, source.id, start, end, next, displayWidth, source.updatedBy],
      );
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new IdentityBackfillProjectionError("RANGE_SOURCE_CONFLICT", "pseudonym_time_range", source.id);
      }
      throw error;
    }
  }

  async syncOperation(
    executor: SqlExecutor,
    sourceOperationId: number,
    examCycleId: number,
    eventMetrics: IdentityOperationEventMetrics = {},
  ): Promise<void> {
    const autoAssignedAbsenteeCount = optionalUnsignedCount(
      eventMetrics.autoAssignedAbsenteeCount,
      "auto-assigned absentee count",
    );
    const removedCurrentAbsenteeCount = optionalUnsignedCount(
      eventMetrics.removedCurrentAbsenteeCount,
      "removed current absentee count",
    );
    const [rows] = await executor.execute<LegacyOperationRow[]>(
      `SELECT id, DATE_FORMAT(exam_date, '%Y-%m-%d') AS examDate,
              exam_time AS examTime, period_name AS periodName, admission_name AS admissionName,
              closed, closed_by AS closedBy, closed_at AS closedAt,
              reopened_by AS reopenedBy, reopened_at AS reopenedAt
       FROM pseudonym_operation WHERE id = ? LIMIT 1 FOR UPDATE`,
      [sourceOperationId],
    );
    const source = rows[0];
    if (!source)
      throw new IdentityBackfillProjectionError("SOURCE_OPERATION_NOT_FOUND", "pseudonym_operation", sourceOperationId);
    const admissionId = await this.resolveAdmissionByName(
      executor,
      examCycleId,
      normalizeRequired(source.admissionName, "Admission name"),
      "pseudonym_operation",
      source.id,
    );
    const slotId = await this.resolveSlotBySchedule(executor, admissionId, source, "pseudonym_operation", source.id);
    const [existingRows] = await executor.execute<SourceIdRow[]>(
      `SELECT id, source_operation_id AS sourceId
       FROM pseudonym_operation_state WHERE operation_slot_id = ? LIMIT 1 FOR UPDATE`,
      [slotId],
    );
    const existing = existingRows[0];
    if (existing && existing.sourceId !== null && Number(existing.sourceId) !== source.id) {
      throw new IdentityBackfillProjectionError("OPERATION_SLOT_CONFLICT", "pseudonym_operation", source.id, {
        operationStateId: Number(existing.id),
      });
    }
    const state = source.closed ? "CLOSED" : "OPEN";
    const values = [source.id, state, source.closedBy, source.closedAt, source.reopenedBy, source.reopenedAt];
    let operationStateId: number;
    if (existing) {
      operationStateId = Number(existing.id);
      await executor.execute(
        `UPDATE pseudonym_operation_state
         SET source_operation_id = ?, state = ?, closed_by = ?, closed_at = ?,
             last_reopened_by = ?, last_reopened_at = ?
         WHERE id = ?`,
        [...values, existing.id],
      );
    } else {
      try {
        const [result] = await executor.execute<ResultSetHeader>(
          `INSERT INTO pseudonym_operation_state
          (operation_slot_id, source_operation_id, state, closed_by, closed_at,
           last_reopened_by, last_reopened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [slotId, ...values],
        );
        operationStateId = requiredInsertId(result, "pseudonym operation state");
      } catch (error) {
        if (isDuplicateEntry(error)) {
          throw new IdentityBackfillProjectionError("OPERATION_SOURCE_CONFLICT", "pseudonym_operation", source.id);
        }
        throw error;
      }
    }
    if (source.closedAt && source.closedBy) {
      await this.ensureOperationEvent(executor, operationStateId, "CLOSED", source.closedBy, source.closedAt, {
        autoAssignedAbsenteeCount,
        removedCurrentAbsenteeCount: 0,
      });
    }
    if (source.reopenedAt && source.reopenedBy) {
      await this.ensureOperationEvent(executor, operationStateId, "REOPENED", source.reopenedBy, source.reopenedAt, {
        autoAssignedAbsenteeCount: 0,
        removedCurrentAbsenteeCount,
      });
    }
  }

  async syncAssignment(
    executor: SqlExecutor,
    sourceAssignmentId: number,
    examCycleId: number,
  ): Promise<AssignmentProjectionResult> {
    const [rows] = await executor.execute<LegacyAssignmentRow[]>(
      `SELECT id, candidate_record_id AS candidateRecordId, admission_name AS admissionName,
              pseudonym_no AS pseudonymNo, assignment_mode AS assignmentMode,
              is_absentee AS isAbsentee, auto_assigned_on_close AS autoAssignedOnClose,
              assigned_by AS assignedBy, assigned_at AS assignedAt
       FROM pseudonym_assignment WHERE id = ? LIMIT 1 FOR UPDATE`,
      [sourceAssignmentId],
    );
    const source = rows[0];
    if (!source)
      throw new IdentityBackfillProjectionError(
        "SOURCE_ASSIGNMENT_NOT_FOUND",
        "pseudonym_assignment",
        sourceAssignmentId,
      );
    const parsed = safePseudonym(source.pseudonymNo, "pseudonym_assignment", source.id);
    if (source.candidateRecordId === null) {
      await this.syncLegacyReservation(executor, source, parsed.value, examCycleId);
      return { kind: "LEGACY_RESERVATION" };
    }
    const [contexts] = await executor.execute<AssignmentContextRow[]>(
      `SELECT registration.id AS registrationId, slot.id AS operationSlotId,
              admission.id AS admissionId, cycle.id AS examCycleId,
              policy.pseudonym_scope AS pseudonymScope
       FROM candidate_registration registration
       INNER JOIN candidate candidate_identity ON candidate_identity.id = registration.candidate_id
       INNER JOIN exam_cycle cycle ON cycle.id = candidate_identity.exam_cycle_id
       INNER JOIN schedule_segment segment ON segment.id = registration.schedule_segment_id
       INNER JOIN operation_slot slot ON slot.id = segment.operation_slot_id
       INNER JOIN admission ON admission.id = slot.admission_id
       INNER JOIN number_uniqueness_policy policy ON policy.exam_cycle_id = cycle.id
       WHERE registration.source_candidate_record_id = ? LIMIT 1 FOR UPDATE`,
      [source.candidateRecordId],
    );
    const context = contexts[0];
    if (!context) {
      throw new IdentityBackfillProjectionError("ASSIGNMENT_REGISTRATION_UNMAPPED", "pseudonym_assignment", source.id, {
        sourceCandidateRecordId: source.candidateRecordId,
      });
    }
    const operationId = await this.ensureOperationForSlot(executor, context.operationSlotId);
    const bySource = await executor.execute<ExistingAssignmentRow[]>(
      `SELECT id, registration_id AS registrationId, source_assignment_id AS sourceAssignmentId
       FROM candidate_pseudonym_assignment WHERE source_assignment_id = ? LIMIT 1 FOR UPDATE`,
      [source.id],
    );
    const byRegistration = await executor.execute<ExistingAssignmentRow[]>(
      `SELECT id, registration_id AS registrationId, source_assignment_id AS sourceAssignmentId
       FROM candidate_pseudonym_assignment WHERE registration_id = ? LIMIT 1 FOR UPDATE`,
      [context.registrationId],
    );
    const existingSource = bySource[0][0];
    const existingRegistration = byRegistration[0][0];
    if (
      (existingSource && Number(existingSource.registrationId) !== Number(context.registrationId)) ||
      (existingRegistration &&
        existingRegistration.sourceAssignmentId !== null &&
        Number(existingRegistration.sourceAssignmentId) !== source.id)
    ) {
      throw new IdentityBackfillProjectionError("ASSIGNMENT_IDENTITY_CONFLICT", "pseudonym_assignment", source.id);
    }
    const existing = existingSource ?? existingRegistration;
    let assignmentId: number;
    const values = [
      context.registrationId,
      operationId,
      source.id,
      parsed.value,
      parsed.displayWidth,
      source.assignmentMode,
      Boolean(source.isAbsentee),
      Boolean(source.autoAssignedOnClose),
      source.assignedBy,
      source.assignedAt,
    ];
    if (existing) {
      assignmentId = Number(existing.id);
      await executor.execute(
        `UPDATE candidate_pseudonym_assignment
         SET registration_id = ?, pseudonym_operation_id = ?, source_assignment_id = ?,
             pseudonym_value = ?, display_width = ?, assignment_mode = ?, is_absentee = ?,
             auto_assigned_on_close = ?, assigned_by = ?, assigned_at = ?
         WHERE id = ?`,
        [...values, assignmentId],
      );
    } else {
      try {
        const [result] = await executor.execute<ResultSetHeader>(
          `INSERT INTO candidate_pseudonym_assignment
            (registration_id, pseudonym_operation_id, source_assignment_id,
             pseudonym_value, display_width, assignment_mode, is_absentee,
             auto_assigned_on_close, assigned_by, assigned_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          values,
        );
        assignmentId = requiredInsertId(result, "candidate pseudonym assignment");
      } catch (error) {
        if (isDuplicateEntry(error)) {
          throw new IdentityBackfillProjectionError("ASSIGNMENT_IDENTITY_CONFLICT", "pseudonym_assignment", source.id);
        }
        throw error;
      }
    }
    await this.ensurePseudonymClaim(executor, {
      assignmentId,
      admissionId: Number(context.admissionId),
      operationSlotId: Number(context.operationSlotId),
      pseudonymScope: context.pseudonymScope,
      pseudonymValue: parsed.value,
      sourceAssignmentId: source.id,
    });
    const [events] = await executor.execute<IdRow[]>(
      `SELECT id FROM pseudonym_assignment_event
       WHERE assignment_id = ? AND event_type IN ('ASSIGNED', 'ABSENTEE_AUTO_ASSIGNED')
       LIMIT 1`,
      [assignmentId],
    );
    if (!events[0]) {
      await executor.execute(
        `INSERT INTO pseudonym_assignment_event
          (assignment_id, registration_id, operation_id, event_type,
           pseudonym_value, display_width, assignment_mode, actor_user_id, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          assignmentId,
          context.registrationId,
          operationId,
          source.autoAssignedOnClose ? "ABSENTEE_AUTO_ASSIGNED" : "ASSIGNED",
          parsed.value,
          parsed.displayWidth,
          source.assignmentMode,
          source.assignedBy,
          source.assignedAt,
        ],
      );
    }
    return { kind: "EXACT" };
  }

  async syncAccount(executor: SqlExecutor, sourceUserId: number, examCycleId: number): Promise<void> {
    const [users] = await executor.execute<LegacyAccountRow[]>(
      `SELECT id, role FROM app_user WHERE id = ? LIMIT 1 FOR UPDATE`,
      [sourceUserId],
    );
    const user = users[0];
    if (!user) throw new IdentityBackfillProjectionError("SOURCE_ACCOUNT_NOT_FOUND", "app_user", sourceUserId);
    const [assignments] = await executor.execute<AdmissionNameRow[]>(
      `SELECT admission_name AS admissionName
       FROM user_admission_assignment WHERE user_id = ? ORDER BY admission_name`,
      [sourceUserId],
    );
    const assignedRole = user.role === "OPERATOR" || user.role === "VIEWER";
    const mode = assignedRole && assignments.length > 0 ? "ASSIGNED" : "ALL";
    const admissionIds: number[] = [];
    if (mode === "ASSIGNED") {
      for (const assignment of assignments) {
        const name = normalizeIdentityText(assignment.admissionName);
        const admissionId = await this.resolveAdmissionByName(executor, examCycleId, name, "app_user", sourceUserId);
        admissionIds.push(admissionId);
      }
    }
    await executor.execute(`UPDATE app_user SET admission_scope_mode = ? WHERE id = ?`, [mode, sourceUserId]);
    await executor.execute(`DELETE FROM user_admission_scope_assignment WHERE user_id = ?`, [sourceUserId]);
    for (const admissionId of admissionIds) {
      await executor.execute(`INSERT INTO user_admission_scope_assignment (user_id, admission_id) VALUES (?, ?)`, [
        sourceUserId,
        admissionId,
      ]);
    }
  }

  async syncPrintSnapshot(executor: SqlExecutor, printJobId: string, sourceCandidateRecordId?: number): Promise<void> {
    if (sourceCandidateRecordId !== undefined) {
      await executor.execute(
        `UPDATE print_job job
         INNER JOIN candidate_registration registration
           ON registration.source_candidate_record_id = ?
         INNER JOIN schedule_segment segment ON segment.id = registration.schedule_segment_id
         INNER JOIN operation_slot slot ON slot.id = segment.operation_slot_id
         LEFT JOIN candidate_pseudonym_assignment canonical_assignment
           ON canonical_assignment.registration_id = registration.id
         SET job.candidate_registration_id = COALESCE(job.candidate_registration_id, registration.id),
             job.canonical_assignment_id = COALESCE(job.canonical_assignment_id, canonical_assignment.id),
             job.operation_slot_id = COALESCE(job.operation_slot_id, slot.id)
         WHERE job.id = ?
           AND (job.candidate_registration_id IS NULL OR job.candidate_registration_id = registration.id)
           AND (job.operation_slot_id IS NULL OR job.operation_slot_id = slot.id)
           AND (job.canonical_assignment_id IS NULL
             OR job.canonical_assignment_id = canonical_assignment.id)`,
        [sourceCandidateRecordId, printJobId],
      );
    }
    await executor.execute(
      `INSERT IGNORE INTO print_projection_snapshot (print_job_id, projection_json, projection_digest)
       SELECT job.id,
              JSON_OBJECT(
                'projectionVersion', 1,
                'sourceKind', 'LEGACY_PRINT_JOB',
                'jobNo', job.job_no,
                'labelType', job.label_type,
                'businessRef', job.business_ref,
                'templateId', job.template_id,
                'copies', job.copies,
                'payloadFormat', payload.format,
                'payload', payload.payload,
                'createdAt', DATE_FORMAT(job.created_at, '%Y-%m-%dT%H:%i:%s.%fZ')
              ) AS projection,
              SHA2(CAST(JSON_OBJECT(
                'projectionVersion', 1,
                'sourceKind', 'LEGACY_PRINT_JOB',
                'jobNo', job.job_no,
                'labelType', job.label_type,
                'businessRef', job.business_ref,
                'templateId', job.template_id,
                'copies', job.copies,
                'payloadFormat', payload.format,
                'payload', payload.payload,
                'createdAt', DATE_FORMAT(job.created_at, '%Y-%m-%dT%H:%i:%s.%fZ')
              ) AS CHAR), 256) AS projectionDigest
       FROM print_job job
       INNER JOIN print_job_payload payload ON payload.print_job_id = job.id
       WHERE job.id = ?`,
      [printJobId],
    );
  }

  private async resolveAdmissionByName(
    executor: SqlExecutor,
    examCycleId: number,
    canonicalName: string,
    entityType: string,
    sourceId: number,
  ): Promise<number> {
    const [rows] = await executor.execute<IdRow[]>(
      `SELECT id FROM admission
       WHERE exam_cycle_id = ? AND canonical_name = ? AND status <> 'ARCHIVED'
       ORDER BY id LIMIT 2 FOR UPDATE`,
      [examCycleId, canonicalName],
    );
    if (rows.length !== 1) {
      throw new IdentityBackfillProjectionError(
        rows.length === 0 ? "ADMISSION_UNMAPPED" : "ADMISSION_AMBIGUOUS",
        entityType,
        sourceId,
        { matchCount: rows.length },
      );
    }
    return Number(rows[0]?.id);
  }

  private async resolveRangeSegment(executor: SqlExecutor, source: LegacyRangeRow): Promise<number> {
    const [policies] = await executor.execute<Array<RowDataPacket & { examCycleId: number }>>(
      `SELECT exam_cycle_id AS examCycleId FROM pseudonym_policy
       WHERE source_setting_id = ? LIMIT 1`,
      [source.settingId],
    );
    const cycleId = Number(policies[0]?.examCycleId ?? 0);
    const admissionName = normalizeRequired(source.admissionName, "Admission name");
    const admissionId = await this.resolveAdmissionByName(
      executor,
      cycleId,
      admissionName,
      "pseudonym_time_range",
      source.id,
    );
    const slotId = await this.resolveSlotBySchedule(executor, admissionId, source, "pseudonym_time_range", source.id);
    const names = [source.unitName, source.majorName, source.buildingName, source.roomName].map((value) =>
      normalizeIdentityText(value),
    );
    const [segments] = await executor.execute<IdRow[]>(
      `SELECT id FROM schedule_segment
       WHERE operation_slot_id = ?
         AND unit_name = ? AND major_name = ? AND building_name = ? AND room_name = ?
         AND status <> 'ARCHIVED'
       ORDER BY id LIMIT 2 FOR UPDATE`,
      [slotId, ...names],
    );
    if (segments.length !== 1) {
      throw new IdentityBackfillProjectionError(
        segments.length === 0 ? "RANGE_SEGMENT_UNMAPPED" : "RANGE_SEGMENT_AMBIGUOUS",
        "pseudonym_time_range",
        source.id,
        { matchCount: segments.length },
      );
    }
    return Number(segments[0]?.id);
  }

  private async resolveSlotBySchedule(
    executor: SqlExecutor,
    admissionId: number,
    source: { examDate: string; examTime: string; periodName: string },
    entityType: string,
    sourceId: number,
  ): Promise<number> {
    const [slots] = await executor.execute<IdRow[]>(
      `SELECT id FROM operation_slot
       WHERE admission_id = ? AND exam_date = ? AND start_time = ?
         AND period_canonical_name = ? AND status <> 'ARCHIVED'
       ORDER BY id LIMIT 2 FOR UPDATE`,
      [
        admissionId,
        source.examDate,
        normalizeDatabaseTime(source.examTime),
        normalizeRequired(source.periodName, "Period name"),
      ],
    );
    if (slots.length !== 1) {
      throw new IdentityBackfillProjectionError(
        slots.length === 0 ? "OPERATION_SLOT_UNMAPPED" : "OPERATION_SLOT_AMBIGUOUS",
        entityType,
        sourceId,
        { matchCount: slots.length },
      );
    }
    return Number(slots[0]?.id);
  }

  private async ensureOperationForSlot(executor: SqlExecutor, operationSlotId: number): Promise<number> {
    const [result] = await executor.execute<ResultSetHeader>(
      `INSERT INTO pseudonym_operation_state (operation_slot_id, state)
       VALUES (?, 'OPEN')
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [operationSlotId],
    );
    return requiredInsertId(result, "pseudonym operation state");
  }

  private async ensureOperationEvent(
    executor: SqlExecutor,
    operationId: number,
    eventType: "CLOSED" | "REOPENED",
    actorUserId: number,
    occurredAt: Date | string,
    metrics: Required<IdentityOperationEventMetrics>,
  ): Promise<void> {
    const [rows] = await executor.execute<IdRow[]>(
      `SELECT id FROM pseudonym_operation_event
       WHERE operation_id = ? AND event_type = ? AND actor_user_id = ? AND occurred_at = ?
       LIMIT 1`,
      [operationId, eventType, actorUserId, occurredAt],
    );
    if (rows[0]) return;
    await executor.execute(
      `INSERT INTO pseudonym_operation_event
        (operation_id, event_type, auto_assigned_absentee_count,
         removed_current_absentee_count, actor_user_id, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        operationId,
        eventType,
        metrics.autoAssignedAbsenteeCount,
        metrics.removedCurrentAbsenteeCount,
        actorUserId,
        occurredAt,
      ],
    );
  }

  private async ensurePseudonymClaim(
    executor: SqlExecutor,
    input: {
      assignmentId: number;
      admissionId: number;
      operationSlotId: number;
      pseudonymScope: "ADMISSION" | "SCHEDULE";
      pseudonymValue: number;
      sourceAssignmentId: number;
    },
  ): Promise<void> {
    const scheduleScoped = input.pseudonymScope === "SCHEDULE";
    const scopeKey = scheduleScoped
      ? pseudonymScheduleScopeKey(input.operationSlotId)
      : pseudonymAdmissionScopeKey(input.admissionId);
    const [reservations] = await executor.execute<SourceIdRow[]>(
      `SELECT reservation.id, reservation.source_assignment_id AS sourceId
       FROM legacy_pseudonym_reservation reservation
       WHERE reservation.pseudonym_value = ?
         AND (
           reservation.admission_id = ?
           OR (
             reservation.admission_id IS NULL
             AND reservation.exam_cycle_id = (
               SELECT admission.exam_cycle_id FROM admission WHERE admission.id = ?
             )
           )
         )
       ORDER BY reservation.id LIMIT 1 FOR UPDATE`,
      [input.pseudonymValue, input.admissionId, input.admissionId],
    );
    if (reservations[0]) {
      throw new IdentityBackfillProjectionError(
        "PSEUDONYM_NUMBER_RESERVED",
        "pseudonym_assignment",
        input.sourceAssignmentId,
      );
    }
    const byAssignment = await executor.execute<Array<RowDataPacket & { assignmentId: number }>>(
      `SELECT assignment_id AS assignmentId FROM pseudonym_number_claim
       WHERE assignment_id = ? LIMIT 1 FOR UPDATE`,
      [input.assignmentId],
    );
    const byNumber = await executor.execute<Array<RowDataPacket & { assignmentId: number }>>(
      `SELECT assignment_id AS assignmentId FROM pseudonym_number_claim
       WHERE scope_key = ? AND pseudonym_value = ? LIMIT 1 FOR UPDATE`,
      [scopeKey, input.pseudonymValue],
    );
    const ownerByAssignment = byAssignment[0][0]?.assignmentId;
    const ownerByNumber = byNumber[0][0]?.assignmentId;
    if (
      (ownerByAssignment !== undefined && Number(ownerByAssignment) !== input.assignmentId) ||
      (ownerByNumber !== undefined && Number(ownerByNumber) !== input.assignmentId)
    ) {
      throw new IdentityBackfillProjectionError(
        "PSEUDONYM_NUMBER_CLAIM_CONFLICT",
        "pseudonym_assignment",
        input.sourceAssignmentId,
      );
    }
    await executor.execute(
      `INSERT INTO pseudonym_number_claim
        (assignment_id, scope_kind, admission_id, operation_slot_id, scope_key, pseudonym_value)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE scope_kind = VALUES(scope_kind), admission_id = VALUES(admission_id),
         operation_slot_id = VALUES(operation_slot_id), scope_key = VALUES(scope_key),
         pseudonym_value = VALUES(pseudonym_value)`,
      [
        input.assignmentId,
        input.pseudonymScope,
        input.admissionId,
        scheduleScoped ? input.operationSlotId : null,
        scopeKey,
        input.pseudonymValue,
      ],
    );
  }

  private async syncLegacyReservation(
    executor: SqlExecutor,
    source: LegacyAssignmentRow,
    pseudonymValue: number,
    examCycleId: number,
  ): Promise<void> {
    const admissionName = normalizeIdentityText(source.admissionName);
    let admissionId: number | null = null;
    if (admissionName) {
      try {
        admissionId = await this.resolveAdmissionByName(
          executor,
          examCycleId,
          admissionName,
          "pseudonym_assignment",
          source.id,
        );
      } catch (error) {
        if (!(error instanceof IdentityBackfillProjectionError) || error.code !== "ADMISSION_UNMAPPED") throw error;
      }
    }
    const scopeKey =
      admissionId === null ? defaultPolicyScopeKey(examCycleId) : pseudonymAdmissionScopeKey(admissionId);
    const [sourceReservations] = await executor.execute<LegacyReservationRow[]>(
      `SELECT exam_cycle_id AS examCycleId, admission_id AS admissionId,
              scope_key AS scopeKey, pseudonym_value AS pseudonymValue
       FROM legacy_pseudonym_reservation
       WHERE source_assignment_id = ? LIMIT 1 FOR UPDATE`,
      [source.id],
    );
    const sourceReservation = sourceReservations[0];
    if (sourceReservation) {
      const sameAdmission =
        sourceReservation.admissionId === null
          ? admissionId === null
          : Number(sourceReservation.admissionId) === admissionId;
      if (
        Number(sourceReservation.examCycleId) !== examCycleId ||
        !sameAdmission ||
        !sourceReservation.scopeKey.equals(scopeKey) ||
        Number(sourceReservation.pseudonymValue) !== pseudonymValue
      ) {
        throw new IdentityBackfillProjectionError(
          "LEGACY_RESERVATION_IMMUTABLE_CONFLICT",
          "pseudonym_assignment",
          source.id,
        );
      }
      return;
    }
    const [canonicalClaims] = await executor.execute<SourceIdRow[]>(
      `SELECT claim.id, assignment.source_assignment_id AS sourceId
       FROM pseudonym_number_claim claim
       INNER JOIN candidate_pseudonym_assignment assignment ON assignment.id = claim.assignment_id
       INNER JOIN admission ON admission.id = claim.admission_id
       WHERE claim.pseudonym_value = ?
         AND (
           (? IS NOT NULL AND claim.admission_id = ?)
           OR (? IS NULL AND admission.exam_cycle_id = ?)
         )
       ORDER BY claim.id LIMIT 1 FOR UPDATE`,
      [pseudonymValue, admissionId, admissionId, admissionId, examCycleId],
    );
    if (canonicalClaims[0]) {
      throw new IdentityBackfillProjectionError("PSEUDONYM_NUMBER_RESERVED", "pseudonym_assignment", source.id);
    }
    const [reservationConflicts] = await executor.execute<SourceIdRow[]>(
      `SELECT id, source_assignment_id AS sourceId
       FROM legacy_pseudonym_reservation
       WHERE exam_cycle_id = ? AND pseudonym_value = ?
         AND (
           ? IS NULL
           OR admission_id IS NULL
           OR admission_id = ?
         )
       ORDER BY id LIMIT 1 FOR UPDATE`,
      [examCycleId, pseudonymValue, admissionId, admissionId],
    );
    if (reservationConflicts[0]) {
      throw new IdentityBackfillProjectionError("LEGACY_RESERVATION_CONFLICT", "pseudonym_assignment", source.id);
    }
    const [existing] = await executor.execute<Array<RowDataPacket & { sourceAssignmentId: number }>>(
      `SELECT source_assignment_id AS sourceAssignmentId
       FROM legacy_pseudonym_reservation
       WHERE scope_key = ? AND pseudonym_value = ? LIMIT 1 FOR UPDATE`,
      [scopeKey, pseudonymValue],
    );
    if (existing[0] && Number(existing[0].sourceAssignmentId) !== source.id) {
      throw new IdentityBackfillProjectionError("LEGACY_RESERVATION_CONFLICT", "pseudonym_assignment", source.id);
    }
    try {
      await executor.execute(
        `INSERT INTO legacy_pseudonym_reservation
          (exam_cycle_id, admission_id, source_assignment_id, scope_key, pseudonym_value, reason_code)
         VALUES (?, ?, ?, ?, ?, 'UNMAPPED_SOURCE_ASSIGNMENT')`,
        [examCycleId, admissionId, source.id, scopeKey, pseudonymValue],
      );
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new IdentityBackfillProjectionError("LEGACY_RESERVATION_CONFLICT", "pseudonym_assignment", source.id);
      }
      throw error;
    }
  }
}

function safePseudonym(raw: string, entityType: string, sourceId: number) {
  try {
    const parsed = parseCanonicalPseudonymNumber(raw);
    if (!parsed || parsed.displayWidth > 100) throw new TypeError("Invalid pseudonym number.");
    return parsed;
  } catch {
    throw new IdentityBackfillProjectionError("PSEUDONYM_VALUE_INVALID", entityType, sourceId);
  }
}

function normalizeRequired(value: string, label: string): string {
  const normalized = normalizeIdentityText(value);
  if (!normalized) throw new TypeError(`${label} must not be blank.`);
  return normalized;
}

function normalizeDatabaseTime(value: string): string {
  const trimmed = value.trim();
  return trimmed.length === 5 ? `${trimmed}:00` : trimmed;
}

function requiredInsertId(result: ResultSetHeader, label: string): number {
  const id = Number(result.insertId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Database did not resolve ${label}.`);
  return id;
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function optionalUnsignedCount(value: number | undefined, label: string): number {
  const count = value ?? 0;
  if (!Number.isSafeInteger(count) || count < 0 || count > 4_294_967_295) {
    throw new TypeError(`Identity operation ${label} must be an unsigned 32-bit integer.`);
  }
  return count;
}

function isDuplicateEntry(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
}
