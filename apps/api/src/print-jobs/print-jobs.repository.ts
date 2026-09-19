import { findActiveLabelTemplate } from "../label-templates/active-label-template.js";
import { Injectable } from "@nestjs/common";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
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
  candidateName: string;
  birthDate: string;
  examName: string;
  examDate: string;
  examStartTime: string;
  examEndTime: string;
  periodName: string;
  admissionName: string;
  admissionCode: string;
  unitName: string;
  majorName: string;
  buildingName: string;
  roomName: string;
  waitingRoom: string;
  seatNo: string;
  groupName: string;
  opt1: string;
  opt2: string;
  opt3: string;
  labelBarcode: string;
  preassignedNumber: string;
  pseudonymNumber: string;
  absent: boolean;
  schoolName: string;
  academicYear: number;
  systemName: string;
  roomAssignedCount: number;
  roomPresentCount: number;
  roomAbsentCount: number;
}

export interface PrintPolicyRecord {
  assignmentMethod: string;
  printPreassignedLabel: number | boolean;
  labelTemplateId: number | null;
}

export interface LabelTemplateRecord {
  id: number;
  zplTemplate: string;
  layout: unknown | null;
}

export interface PrintJobOwnerRecord {
  requestedBy: number;
  workstationId: number | null;
  status: PrintJobStatus;
  isExpired: number;
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
  candidateRecordId: number;
  templateId: number;
  workstationId: number;
  requestedBy: number;
  idempotencyKey: string;
  requestFingerprint: string;
  copies: number;
  expirySeconds: number;
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
  async hasPrintedLabel(executor: SqlExecutor, candidateRecordId: number): Promise<boolean> {
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT id FROM print_job
       WHERE candidate_record_id = ? AND label_type = 'PSEUDONYM_LABEL'
         AND status = 'SENT' AND sent_at IS NOT NULL
       LIMIT 1 FOR UPDATE`,
      [candidateRecordId],
    );
    return rows.length > 0;
  }

  async findAssignedExamName(
    executor: SqlExecutor,
    schedule: PrintJobScheduleKey,
    defaultExamName: string,
  ): Promise<string | null> {
    const [rows] = await executor.execute<Array<RowDataPacket & { examName: string }>>(
      `SELECT COALESCE(pa.exam_name, ?) AS examName
       FROM candidate_record cr
       LEFT JOIN pseudonym_assignment pa ON pa.candidate_record_id = cr.id
       WHERE cr.examinee_no = ? AND cr.exam_date = ? AND cr.start_time = ?
         AND cr.period_name = ? AND cr.admission = ? AND cr.status = 'ACTIVE'
         AND (pa.id IS NOT NULL OR NULLIF(cr.temporary_no, '') IS NOT NULL)
       LIMIT 1`,
      [defaultExamName, ...scheduleParameters(schedule)],
    );
    return rows[0]?.examName ?? null;
  }

  async findPrintPolicyForUpdate(
    executor: SqlExecutor,
    examName: string,
    admissionName: string,
    locking = true,
  ): Promise<PrintPolicyRecord | null> {
    const [rows] = await executor.execute<Array<RowDataPacket & PrintPolicyRecord>>(
      `SELECT assignment_method AS assignmentMethod,
              print_preassigned_label AS printPreassignedLabel,
              label_template_id AS labelTemplateId
       FROM pseudonym_setting
       WHERE exam_name = ? AND admission_name IN (?, '') AND active = TRUE
       ORDER BY CASE WHEN admission_name = ? THEN 0 ELSE 1 END
       LIMIT 1${locking ? " LOCK IN SHARE MODE" : ""}`,
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
      `SELECT pj.id, pj.job_no AS jobNo, CASE WHEN pj.status = 'READY' AND pj.expires_at <= NOW(3) THEN 'EXPIRED' ELSE pj.status END AS status, pj.copies, pjp.format, pjp.payload,
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
    locking = true,
  ): Promise<PrintCandidateRecord | null> {
    const [rows] = await executor.execute<Array<RowDataPacket & PrintCandidateRecord>>(
      `SELECT cr.id AS candidateRecordId, cr.examinee_no AS examineeNo, cr.name AS candidateName,
              COALESCE(DATE_FORMAT(cr.birth_date, '%Y-%m-%d'), '') AS birthDate,
              cr.exam_name AS examName, DATE_FORMAT(cr.exam_date, '%Y-%m-%d') AS examDate,
              cr.start_time AS examStartTime, cr.end_time AS examEndTime, cr.period_name AS periodName,
              cr.admission AS admissionName, cr.admission_code AS admissionCode,
              cr.unit_name AS unitName, cr.major AS majorName,
              cr.building_name AS buildingName, cr.room_name AS roomName,
              cr.waiting_room AS waitingRoom,
              COALESCE(cr.designated_sort, '') AS seatNo, cr.group_name AS groupName,
              cr.opt1, cr.opt2, cr.opt3, cr.label_barcode AS labelBarcode,
              cr.temporary_no AS preassignedNumber,
              COALESCE(pa.pseudonym_no, NULLIF(cr.temporary_no, '')) AS pseudonymNumber,
              COALESCE(pa.is_absentee, FALSE) AS absent,
              COALESCE((SELECT school_name FROM system_profile WHERE id = 1), '') AS schoolName, COALESCE((SELECT academic_year FROM system_profile WHERE id = 1), YEAR(cr.exam_date)) AS academicYear,
              COALESCE((SELECT system_name FROM system_profile WHERE id = 1), '') AS systemName,
              0 AS roomAssignedCount, 0 AS roomPresentCount, 0 AS roomAbsentCount
       FROM candidate_record cr
       LEFT JOIN pseudonym_assignment pa ON pa.candidate_record_id = cr.id
       WHERE cr.examinee_no = ? AND cr.exam_date = ? AND cr.start_time = ?
         AND cr.period_name = ? AND cr.admission = ? AND cr.status = 'ACTIVE'
         AND (pa.id IS NOT NULL OR NULLIF(cr.temporary_no, '') IS NOT NULL) LIMIT 1${locking ? " FOR UPDATE" : ""}`,
      scheduleParameters(schedule),
    );
    return rows[0] ?? null;
  }

  async roomCounts(executor: SqlExecutor, candidate: PrintCandidateRecord) {
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS roomAssignedCount,
      COALESCE(SUM(pa.id IS NOT NULL AND pa.is_absentee = FALSE), 0) AS roomPresentCount,
      COALESCE(SUM(pa.id IS NOT NULL AND pa.is_absentee = TRUE), 0) AS roomAbsentCount
      FROM candidate_record cr LEFT JOIN pseudonym_assignment pa ON pa.candidate_record_id = cr.id
      WHERE cr.exam_date = ? AND cr.start_time = ? AND cr.period_name = ? AND cr.admission = ?
        AND cr.building_name = ? AND cr.room_name = ? AND cr.status = 'ACTIVE'`,
      [
        candidate.examDate,
        candidate.examStartTime,
        candidate.periodName,
        candidate.admissionName,
        candidate.buildingName,
        candidate.roomName,
      ],
    );
    return {
      roomAssignedCount: Number(rows[0].roomAssignedCount),
      roomPresentCount: Number(rows[0].roomPresentCount),
      roomAbsentCount: Number(rows[0].roomAbsentCount),
    };
  }

  async hasPendingLabel(executor: SqlExecutor, candidateRecordId: number) {
    const [rows] = await executor.execute<RowDataPacket[]>(
      "SELECT id FROM print_job WHERE candidate_record_id = ? AND label_type = 'PSEUDONYM_LABEL' AND status IN ('CREATED', 'READY', 'DISPATCHING') AND expires_at > NOW(3) LIMIT 1 FOR UPDATE",
      [candidateRecordId],
    );
    return rows.length > 0;
  }

  async findActiveLabelTemplate(
    executor: SqlExecutor,
    labelTemplateId: number | null,
    locking = false,
  ): Promise<LabelTemplateRecord | null> {
    return findActiveLabelTemplate(executor, labelTemplateId, locking);
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
        (id, job_no, label_type, business_ref, candidate_record_id, template_id,
         workstation_id, requested_by, idempotency_key, request_fingerprint, copies, status, expires_at)
       VALUES (?, ?, 'PSEUDONYM_LABEL', ?, ?, ?, ?, ?, ?, ?, ?, 'READY', DATE_ADD(NOW(3), INTERVAL ? SECOND))`,
      [
        record.id,
        record.jobNo,
        record.businessReference,
        record.candidateRecordId,
        record.templateId,
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

  async findJobForUpdate(executor: SqlExecutor, id: string): Promise<PrintJobOwnerRecord | null> {
    const [rows] = await executor.execute<Array<RowDataPacket & PrintJobOwnerRecord>>(
      `SELECT requested_by AS requestedBy, workstation_id AS workstationId, status,
              CASE WHEN expires_at <= NOW(3) THEN 1 ELSE 0 END AS isExpired
       FROM print_job WHERE id = ? LIMIT 1 FOR UPDATE`,
      [id],
    );
    return rows[0] ?? null;
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
