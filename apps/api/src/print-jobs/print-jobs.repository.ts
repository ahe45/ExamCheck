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
