import { Injectable } from "@nestjs/common";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { UserRole } from "../auth/auth.types.js";
import type { SqlExecutor } from "../common/database/sql-executor.js";

export type PrintJobStatus = "CREATED" | "READY" | "DISPATCHING" | "SENT" | "FAILED" | "CANCELLED" | "EXPIRED";

export interface PrintJobScheduleKey {
  examineeNo: string;
  examDate: string;
  examTime: string;
  periodName: string;
  admissionName: string;
}

export interface PrintCandidateRecord {
  candidateRecordId: number;
  examineeNo: string;
  examDate: string;
  roomName: string;
  seatNo: string;
  labelBarcode: string;
  pseudonymNumber: string;
}

export interface PrintPolicyRecord {
  assignmentMethod: string;
  printPreassignedLabel: number | boolean;
}

export interface LabelTemplateRecord {
  id: number;
  version: number;
  zplTemplate: string;
}

export interface PrintJobOwnerRecord {
  requestedBy: number;
  workstationId: number | null;
  status: PrintJobStatus;
  isExpired: number;
}

export interface PrintJobReissueSourceRecord extends PrintJobOwnerRecord {
  hasSnapshot: number;
}

export interface PrintJobReissueContext {
  actorRole: UserRole;
  actorAdmissionScopeMode: "ALL" | "ASSIGNED" | null;
  examCycleId: number;
  admissionId: number;
  admissionName: string;
  workstationEnabled: number;
}

export interface PrintJobReissuePolicy {
  assignmentMethod: string;
  printPreassignedLabel: number | boolean;
}

export interface StoredPrintJob {
  requestFingerprint: string | null;
  response: {
    id: string;
    jobNo: string;
    status: PrintJobStatus;
    copies: number;
    format: string;
    payload: string;
  };
}

export interface NewPrintJobRecord {
  id: string;
  jobNo: string;
  businessReference: string;
  templateId: number;
  templateVersion: number;
  workstationId: number;
  requestedBy: number;
  idempotencyKey: string;
  requestFingerprint: string;
  copies: number;
  expirySeconds: number;
}

export type PrintJobReissueType = "RETRY" | "REPRINT";

export interface NewPrintJobReissueRecord {
  id: string;
  jobNo: string;
  sourcePrintJobId: string;
  requestedBy: number;
  idempotencyKey: string;
  requestFingerprint: string;
  expirySeconds: number;
  reissueType: PrintJobReissueType;
  reasonCode: string;
}

interface PrintJobResponseRow extends RowDataPacket {
  id: string;
  jobNo: string;
  status: PrintJobStatus;
  copies: number;
  format: string;
  payload: string;
  requestFingerprint: string | null;
}

@Injectable()
export class PrintJobsRepository {
  async findAssignedExamName(executor: SqlExecutor, schedule: PrintJobScheduleKey): Promise<string | null> {
    const [rows] = await executor.execute<Array<RowDataPacket & { examName: string }>>(
      `SELECT pa.exam_name AS examName
       FROM candidate_record cr
       INNER JOIN examinee e ON e.examinee_no = cr.examinee_no
       INNER JOIN pseudonym_assignment pa ON pa.candidate_record_id = cr.id
       WHERE cr.examinee_no = ? AND cr.exam_date = ? AND cr.start_time = ?
         AND cr.period_name = ? AND cr.admission = ? AND e.status = 'ACTIVE'
       LIMIT 1`,
      scheduleParameters(schedule),
    );
    return rows[0]?.examName ?? null;
  }

  async findPrintPolicyForUpdate(
    executor: SqlExecutor,
    examName: string,
    admissionName: string,
  ): Promise<PrintPolicyRecord | null> {
    const [rows] = await executor.execute<Array<RowDataPacket & PrintPolicyRecord>>(
      `SELECT assignment_method AS assignmentMethod,
              print_preassigned_label AS printPreassignedLabel
       FROM pseudonym_setting
       WHERE exam_name = ? AND admission_name IN (?, '') AND active = TRUE
       ORDER BY CASE WHEN admission_name = ? THEN 0 ELSE 1 END
       LIMIT 1 FOR UPDATE`,
      [examName, admissionName, admissionName],
    );
    return rows[0] ?? null;
  }

  async findByIdempotencyKey(
    executor: SqlExecutor,
    requestedBy: number,
    idempotencyKey: string,
  ): Promise<StoredPrintJob | null> {
    const [rows] = await executor.execute<PrintJobResponseRow[]>(
      `SELECT pj.id, pj.job_no AS jobNo, pj.status, pj.copies, pjp.format, pjp.payload,
              pj.request_fingerprint AS requestFingerprint
       FROM print_job pj
       INNER JOIN print_job_payload pjp ON pjp.print_job_id = pj.id
       WHERE pj.requested_by = ? AND pj.idempotency_key = ?
       LIMIT 1`,
      [requestedBy, idempotencyKey],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      requestFingerprint: row.requestFingerprint,
      response: {
        id: row.id,
        jobNo: row.jobNo,
        status: row.status,
        copies: Number(row.copies),
        format: row.format,
        payload: row.payload,
      },
    };
  }

  async findCandidateForUpdate(
    executor: SqlExecutor,
    schedule: PrintJobScheduleKey,
  ): Promise<PrintCandidateRecord | null> {
    const [rows] = await executor.execute<Array<RowDataPacket & PrintCandidateRecord>>(
      `SELECT cr.id AS candidateRecordId, cr.examinee_no AS examineeNo, DATE_FORMAT(cr.exam_date, '%Y-%m-%d') AS examDate,
              cr.room_name AS roomName, COALESCE(cr.designated_sort, '') AS seatNo,
              CONCAT('EX', cr.examinee_no) AS labelBarcode,
              pa.pseudonym_no AS pseudonymNumber
       FROM candidate_record cr
       INNER JOIN examinee e ON e.examinee_no = cr.examinee_no
       INNER JOIN pseudonym_assignment pa ON pa.candidate_record_id = cr.id
       WHERE cr.examinee_no = ? AND cr.exam_date = ? AND cr.start_time = ?
         AND cr.period_name = ? AND cr.admission = ? AND e.status = 'ACTIVE' LIMIT 1 FOR UPDATE`,
      scheduleParameters(schedule),
    );
    return rows[0] ?? null;
  }

  async findActiveLabelTemplate(executor: SqlExecutor): Promise<LabelTemplateRecord | null> {
    const [rows] = await executor.query<Array<RowDataPacket & LabelTemplateRecord>>(
      `SELECT id, version, zpl_template AS zplTemplate
       FROM label_template WHERE code = 'PSEUDONYM_LABEL' AND active = TRUE
       ORDER BY version DESC LIMIT 1`,
    );
    return rows[0] ?? null;
  }

  async findEnabledWorkstationId(executor: SqlExecutor, workstationCode: string): Promise<number | null> {
    const [rows] = await executor.execute<Array<RowDataPacket & { id: number }>>(
      "SELECT id FROM workstation WHERE code = ? AND enabled = TRUE LIMIT 1",
      [workstationCode],
    );
    return rows[0]?.id ?? null;
  }

  async insertPrintJob(executor: SqlExecutor, record: NewPrintJobRecord): Promise<void> {
    await executor.execute<ResultSetHeader>(
      `INSERT INTO print_job
        (id, job_no, label_type, business_ref, template_id, template_version,
         workstation_id, requested_by, idempotency_key, request_fingerprint, copies, status, expires_at)
       VALUES (?, ?, 'PSEUDONYM_LABEL', ?, ?, ?, ?, ?, ?, ?, ?, 'READY', DATE_ADD(NOW(3), INTERVAL ? SECOND))`,
      [
        record.id,
        record.jobNo,
        record.businessReference,
        record.templateId,
        record.templateVersion,
        record.workstationId,
        record.requestedBy,
        record.idempotencyKey,
        record.requestFingerprint,
        record.copies,
        record.expirySeconds,
      ],
    );
  }

  async insertPayload(executor: SqlExecutor, printJobId: string, payload: string): Promise<void> {
    await executor.execute("INSERT INTO print_job_payload (print_job_id, format, payload) VALUES (?, 'ZPL', ?)", [
      printJobId,
      payload,
    ]);
  }

  async insertReissuedPrintJob(executor: SqlExecutor, record: NewPrintJobReissueRecord): Promise<void> {
    const [result] = await executor.execute<ResultSetHeader>(
      `INSERT INTO print_job
        (id, job_no, label_type, business_ref, candidate_registration_id, canonical_assignment_id,
         operation_slot_id, template_id, template_version, workstation_id, requested_by,
         idempotency_key, request_fingerprint, copies, status, expires_at, original_job_id, reprint_reason)
       SELECT ?, ?, source.label_type, source.business_ref, source.candidate_registration_id,
              source.canonical_assignment_id, source.operation_slot_id, source.template_id,
              source.template_version, source.workstation_id, ?, ?, ?, source.copies, 'READY',
              DATE_ADD(NOW(3), INTERVAL ? SECOND), COALESCE(source.original_job_id, source.id), ?
       FROM print_job source WHERE source.id = ?`,
      [
        record.id,
        record.jobNo,
        record.requestedBy,
        record.idempotencyKey,
        record.requestFingerprint,
        record.expirySeconds,
        record.reasonCode,
        record.sourcePrintJobId,
      ],
    );
    assertSingleCopiedRow(result, "출력 재발행 원본을 찾을 수 없습니다.");
  }

  async insertPayloadFromSnapshot(executor: SqlExecutor, printJobId: string, sourcePrintJobId: string): Promise<void> {
    const [result] = await executor.execute<ResultSetHeader>(
      `INSERT INTO print_job_payload (print_job_id, format, payload)
       SELECT ?, JSON_UNQUOTE(JSON_EXTRACT(projection_json, '$.payloadFormat')),
              JSON_UNQUOTE(JSON_EXTRACT(projection_json, '$.payload'))
       FROM print_projection_snapshot WHERE print_job_id = ?`,
      [printJobId, sourcePrintJobId],
    );
    assertSingleCopiedRow(result, "출력 재발행 원본 snapshot을 찾을 수 없습니다.");
  }

  async insertReissueEvent(executor: SqlExecutor, record: NewPrintJobReissueRecord): Promise<void> {
    await executor.execute<ResultSetHeader>(
      `INSERT INTO print_job_reissue_event
        (source_print_job_id, reissued_print_job_id, reissue_type, reason_code, actor_user_id)
       VALUES (?, ?, ?, ?, ?)`,
      [record.sourcePrintJobId, record.id, record.reissueType, record.reasonCode, record.requestedBy],
    );
  }

  async findJobForUpdate(executor: SqlExecutor, id: string): Promise<PrintJobOwnerRecord | null> {
    const [rows] = await executor.execute<Array<RowDataPacket & PrintJobOwnerRecord>>(
      `SELECT requested_by AS requestedBy, workstation_id AS workstationId, status,
              CASE WHEN expires_at <= NOW(3) THEN 1 ELSE 0 END AS isExpired
       FROM print_job WHERE id = ? LIMIT 1 FOR UPDATE`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findReissueSourceForUpdate(executor: SqlExecutor, id: string): Promise<PrintJobReissueSourceRecord | null> {
    const [rows] = await executor.execute<Array<RowDataPacket & PrintJobReissueSourceRecord>>(
      `SELECT requested_by AS requestedBy, workstation_id AS workstationId, status,
              CASE WHEN expires_at <= NOW(3) THEN 1 ELSE 0 END AS isExpired,
              EXISTS(SELECT 1 FROM print_projection_snapshot snapshot
                     WHERE snapshot.print_job_id = print_job.id) AS hasSnapshot
       FROM print_job WHERE id = ? LIMIT 1 FOR UPDATE`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findReissueContextForUpdate(
    executor: SqlExecutor,
    printJobId: string,
    actorUserId: number,
  ): Promise<PrintJobReissueContext | null> {
    const [rows] = await executor.execute<Array<RowDataPacket & PrintJobReissueContext>>(
      `SELECT actor.role AS actorRole, actor.admission_scope_mode AS actorAdmissionScopeMode,
              cycle.id AS examCycleId, admission.id AS admissionId,
              admission.canonical_name AS admissionName,
              workstation.enabled AS workstationEnabled
       FROM print_job job
       INNER JOIN candidate_registration registration
         ON registration.id = job.candidate_registration_id AND registration.status = 'ACTIVE'
       INNER JOIN candidate candidate_identity
         ON candidate_identity.id = registration.candidate_id AND candidate_identity.status = 'ACTIVE'
       INNER JOIN schedule_segment segment
         ON segment.id = registration.schedule_segment_id AND segment.status = 'ACTIVE'
       INNER JOIN operation_slot slot
         ON slot.id = segment.operation_slot_id AND slot.id = job.operation_slot_id AND slot.status = 'ACTIVE'
       INNER JOIN admission
         ON admission.id = slot.admission_id AND admission.status = 'ACTIVE'
       INNER JOIN exam_cycle cycle
         ON cycle.id = admission.exam_cycle_id
        AND cycle.id = candidate_identity.exam_cycle_id
        AND cycle.status = 'ACTIVE'
       INNER JOIN candidate_pseudonym_assignment assignment
         ON assignment.id = job.canonical_assignment_id
        AND assignment.registration_id = registration.id
       INNER JOIN pseudonym_operation_state operation
         ON operation.id = assignment.pseudonym_operation_id
        AND operation.operation_slot_id = slot.id
       INNER JOIN workstation ON workstation.id = job.workstation_id
       INNER JOIN app_user actor ON actor.id = ? AND actor.enabled = TRUE
       WHERE job.id = ? LIMIT 1 FOR UPDATE`,
      [actorUserId, printJobId],
    );
    return rows[0] ?? null;
  }

  async hasAdmissionScopeForUpdate(executor: SqlExecutor, userId: number, admissionId: number): Promise<boolean> {
    const [rows] = await executor.execute<Array<RowDataPacket & { admissionId: number }>>(
      `SELECT admission_id AS admissionId
       FROM user_admission_scope_assignment
       WHERE user_id = ? AND admission_id = ? LIMIT 1 FOR UPDATE`,
      [userId, admissionId],
    );
    return rows.length === 1;
  }

  async listLegacyAdmissionNamesForUpdate(executor: SqlExecutor, userId: number): Promise<string[]> {
    const [rows] = await executor.execute<Array<RowDataPacket & { admissionName: string }>>(
      `SELECT admission_name AS admissionName
       FROM user_admission_assignment
       WHERE user_id = ? ORDER BY admission_name FOR UPDATE`,
      [userId],
    );
    return rows.map((row) => row.admissionName);
  }

  async findEffectivePrintPolicyForUpdate(
    executor: SqlExecutor,
    examCycleId: number,
    admissionId: number,
  ): Promise<PrintJobReissuePolicy | null> {
    const [rows] = await executor.execute<Array<RowDataPacket & PrintJobReissuePolicy>>(
      `SELECT policy.assignment_method AS assignmentMethod,
              policy.print_preassigned_label AS printPreassignedLabel
       FROM pseudonym_policy policy
       WHERE policy.exam_cycle_id = ?
         AND (
           (policy.scope_kind = 'ADMISSION' AND policy.admission_id = ?)
           OR (
             policy.scope_kind = 'DEFAULT'
             AND policy.admission_id IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM pseudonym_policy admission_override
               WHERE admission_override.exam_cycle_id = policy.exam_cycle_id
                 AND admission_override.scope_kind = 'ADMISSION'
                 AND admission_override.admission_id = ?
             )
           )
         )
       ORDER BY policy.id LIMIT 2 FOR UPDATE`,
      [examCycleId, admissionId, admissionId],
    );
    return rows.length === 1 ? rows[0] : null;
  }

  async markExpired(executor: SqlExecutor, id: string): Promise<void> {
    await executor.execute("UPDATE print_job SET status = 'EXPIRED' WHERE id = ? AND status = 'READY'", [id]);
  }

  async markSent(executor: SqlExecutor, id: string): Promise<void> {
    await executor.execute(
      "UPDATE print_job SET status = 'SENT', dispatched_at = NOW(3), sent_at = NOW(3) WHERE id = ? AND status = 'READY'",
      [id],
    );
  }

  async markFailed(executor: SqlExecutor, id: string, errorMessage: string): Promise<void> {
    await executor.execute(
      `UPDATE print_job SET status = 'FAILED', dispatched_at = NOW(3), failed_at = NOW(3),
              error_code = 'CLIENT_SEND_FAILED', error_message = ?
       WHERE id = ? AND status = 'READY'`,
      [errorMessage, id],
    );
  }
}

function scheduleParameters(schedule: PrintJobScheduleKey) {
  return [schedule.examineeNo, schedule.examDate, schedule.examTime, schedule.periodName, schedule.admissionName];
}

function assertSingleCopiedRow(result: ResultSetHeader, message: string): void {
  if (result.affectedRows !== 1) throw new Error(message);
}
