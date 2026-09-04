import { Injectable } from "@nestjs/common";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { AdmissionAccessPredicate } from "../authorization/admission-policy.js";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import type { ExamineeNoUniqueness } from "../uniqueness/number-uniqueness.js";
import type { CandidatePhotoReference, CandidateRecord } from "./candidate-domain.js";
import { candidateFields, candidateKey, type CandidateInput } from "./candidate-fields.js";

export interface CandidateRecordRow extends RowDataPacket, CandidateRecord {
  assignedNumber: string | null;
  assignedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CandidatePhotoRow extends RowDataPacket, CandidatePhotoReference {}

export type CandidateDashboardGroupType = "admission" | "building" | "period" | "waitingRoom";

export interface CandidateDashboardBreakdownRow extends RowDataPacket {
  groupType: CandidateDashboardGroupType;
  name: string;
  total: number;
  assigned: number;
}

interface ExamineeNumberPolicyRow extends RowDataPacket {
  examineeNoUniqueness: ExamineeNoUniqueness;
}

interface CandidateIdRow extends RowDataPacket {
  id: number;
}

export interface CandidateImportScopeGuardRow extends RowDataPacket {
  rangeId: number | null;
  guardType: "RANGE" | "CLOSED";
  date: string;
  time: string;
  period: string;
  admission: string;
  unit: string;
  major: string;
  building: string;
  room: string;
}

@Injectable()
export class CandidatesRepository {
  async list(executor: SqlExecutor): Promise<CandidateRecordRow[]> {
    const [rows] = await executor.query<CandidateRecordRow[]>(`${candidateSelectSql} ORDER BY cr.id ASC`);
    return rows;
  }

  async listDashboardBreakdownCounts(
    executor: SqlExecutor,
    access: AdmissionAccessPredicate,
    admissionName?: string,
  ): Promise<CandidateDashboardBreakdownRow[]> {
    const admissionFilter = admissionName ? " AND cr.admission = ?" : "";
    const [rows] = await executor.execute<CandidateDashboardBreakdownRow[]>(
      `SELECT dashboard_group.group_type AS groupType,
              CASE dashboard_group.group_type
                WHEN 'admission' THEN COALESCE(NULLIF(TRIM(cr.admission), ''), '미지정 전형')
                WHEN 'building' THEN COALESCE(NULLIF(TRIM(cr.building_name), ''), '미지정 건물')
                WHEN 'period' THEN CONCAT(
                  COALESCE(NULLIF(TRIM(cr.period_name), ''), '미지정 교시'),
                  ' · ', DATE_FORMAT(cr.exam_date, '%Y.%m.%d'), ' ', cr.start_time
                )
                ELSE CONCAT(
                  COALESCE(NULLIF(TRIM(cr.building_name), ''), '미지정 건물'),
                  ' · ', COALESCE(NULLIF(TRIM(cr.waiting_room), ''), '미지정 대기실')
                )
              END AS name,
              COUNT(DISTINCT cr.id) AS total,
              COUNT(DISTINCT CASE WHEN pa.id IS NOT NULL THEN cr.id END) AS assigned
       FROM candidate_record cr
       LEFT JOIN pseudonym_assignment pa ON pa.candidate_record_id = cr.id
       CROSS JOIN (
         SELECT 'admission' AS group_type
         UNION ALL SELECT 'building'
         UNION ALL SELECT 'period'
         UNION ALL SELECT 'waitingRoom'
       ) dashboard_group
       WHERE ${access.sql}${admissionFilter}
       GROUP BY dashboard_group.group_type, 2
       ORDER BY dashboard_group.group_type, 2`,
      [...access.params, ...(admissionName ? [admissionName] : [])],
    );
    return rows.map((row) => ({
      ...row,
      total: Number(row.total),
      assigned: Number(row.assigned),
    }));
  }

  async loadExisting(executor: SqlExecutor, options: { forUpdate: boolean }): Promise<Map<string, CandidateRecordRow>> {
    const [rows] = await executor.query<CandidateRecordRow[]>(
      `${candidateSelectSql}${options.forUpdate ? " FOR UPDATE" : ""}`,
    );
    return new Map(rows.map((row) => [candidateKey(row), row]));
  }

  async listOperationallyProtectedCandidateIds(
    executor: SqlExecutor,
    candidateIds: readonly number[],
    examName: string,
  ): Promise<Set<number>> {
    if (!candidateIds.length) return new Set();
    const placeholders = candidateIds.map(() => "?").join(", ");
    const [rows] = await executor.execute<CandidateIdRow[]>(
      `SELECT cr.id
       FROM candidate_record cr
       WHERE cr.id IN (${placeholders})
         AND (
           EXISTS (
             SELECT 1 FROM pseudonym_assignment pa
             WHERE pa.candidate_record_id = cr.id
           )
           OR EXISTS (
             SELECT 1 FROM pseudonym_operation po
             WHERE po.exam_name = ?
               AND po.exam_date = cr.exam_date
               AND po.exam_time = cr.start_time
               AND po.period_name = cr.period_name
               AND po.admission_name = cr.admission
           )
         )`,
      [...candidateIds, examName],
    );
    return new Set(rows.map((row) => Number(row.id)));
  }

  async listImportScopeGuards(executor: SqlExecutor, examName: string): Promise<CandidateImportScopeGuardRow[]> {
    const [rows] = await executor.execute<CandidateImportScopeGuardRow[]>(
      `SELECT ptr.id AS rangeId, 'RANGE' AS guardType, DATE_FORMAT(ptr.exam_date, '%Y-%m-%d') AS date,
              ptr.exam_time AS time, ptr.period_name AS period, ptr.admission,
              ptr.unit_name AS unit, ptr.major, ptr.building_name AS building, ptr.room_name AS room
       FROM pseudonym_time_range ptr
       INNER JOIN pseudonym_setting ps ON ps.id = ptr.setting_id
       WHERE ps.exam_name = ?
       UNION ALL
       SELECT NULL AS rangeId, 'CLOSED' AS guardType, DATE_FORMAT(po.exam_date, '%Y-%m-%d') AS date,
              po.exam_time AS time, po.period_name AS period, po.admission_name AS admission,
              '' AS unit, '' AS major, '' AS building, '' AS room
       FROM pseudonym_operation po
       WHERE po.exam_name = ? AND po.closed = TRUE`,
      [examName, examName],
    );
    return rows;
  }

  async deleteTimeRangesByIds(executor: SqlExecutor, rangeIds: readonly number[]): Promise<number> {
    if (!rangeIds.length) return 0;
    const placeholders = rangeIds.map(() => "?").join(", ");
    const [result] = await executor.execute<ResultSetHeader>(
      `DELETE FROM pseudonym_time_range WHERE id IN (${placeholders})`,
      [...rangeIds],
    );
    return Number(result.affectedRows);
  }

  async loadExamineeNumberUniqueness(
    executor: SqlExecutor,
    options: { forUpdate: boolean },
  ): Promise<ExamineeNoUniqueness> {
    const [rows] = await executor.execute<ExamineeNumberPolicyRow[]>(
      `SELECT examinee_no_uniqueness AS examineeNoUniqueness
       FROM system_profile WHERE id = 1 LIMIT 1${options.forUpdate ? " FOR UPDATE" : ""}`,
    );
    return rows[0]?.examineeNoUniqueness ?? "SYSTEM";
  }

  async insertCandidate(executor: SqlExecutor, candidate: CandidateInput, examName: string): Promise<number> {
    const [result] = await executor.execute<ResultSetHeader>(insertSql, [
      ...candidateValues(candidate),
      examName,
      candidate.examineeNo,
    ]);
    return result.insertId;
  }

  async updateCandidate(executor: SqlExecutor, id: number, candidate: CandidateInput, examName: string): Promise<void> {
    await executor.execute(updateSql, [...candidateValues(candidate), examName, candidate.examineeNo, id]);
  }

  async listCandidatePhotos(executor: SqlExecutor, options: { forUpdate: boolean }): Promise<CandidatePhotoRow[]> {
    const [rows] = await executor.query<CandidatePhotoRow[]>(
      `SELECT cr.id, cr.examinee_no AS examineeNo, cp.content_hash AS photoHash
       FROM candidate_record cr
       LEFT JOIN candidate_photo cp ON cp.candidate_record_id = cr.id${options.forUpdate ? " FOR UPDATE" : ""}`,
    );
    return rows;
  }

  async upsertCandidatePhoto(
    executor: SqlExecutor,
    candidateRecordId: number,
    photo: { fileName: string; mimeType: string; content: Buffer; contentHash: string },
  ): Promise<void> {
    await executor.execute(
      `INSERT INTO candidate_photo (candidate_record_id, file_name, mime_type, content, content_hash)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE file_name = VALUES(file_name), mime_type = VALUES(mime_type),
         content = VALUES(content), content_hash = VALUES(content_hash)`,
      [candidateRecordId, photo.fileName, photo.mimeType, photo.content, photo.contentHash],
    );
  }
}

const aliases = candidateFields
  .map((field) =>
    field.format === "date"
      ? `COALESCE(DATE_FORMAT(cr.${field.dbColumn}, '%Y-%m-%d'), '') AS \`${field.key}\``
      : `cr.${field.dbColumn} AS \`${field.key}\``,
  )
  .join(",\n  ");

const candidateSelectSql = `SELECT cr.id, ${aliases}, pa.pseudonym_no AS assignedNumber, pa.assigned_at AS assignedAt,
  cr.created_at AS createdAt, cr.updated_at AS updatedAt
  FROM candidate_record cr
  LEFT JOIN pseudonym_assignment pa ON pa.candidate_record_id = cr.id`;

const placeholders = candidateFields.map(() => "?").join(", ");
const insertSql = `INSERT INTO candidate_record (${candidateFields.map((field) => field.dbColumn).join(", ")}, exam_name, label_barcode, status)
  VALUES (${placeholders}, ?, CONCAT('EX', ?), 'ACTIVE')`;
const updateSql = `UPDATE candidate_record
  SET ${candidateFields.map((field) => `${field.dbColumn} = ?`).join(", ")}, exam_name = ?, label_barcode = CONCAT('EX', ?), status = 'ACTIVE'
  WHERE id = ?`;

function candidateValues(candidate: CandidateInput): string[] {
  return candidateFields.map((field) => candidate[field.key]);
}
