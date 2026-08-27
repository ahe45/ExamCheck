import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "mysql2/promise";
import type { AdmissionAccessPredicate } from "../authorization/admission-policy.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import type {
  ExamineePhotoRow,
  ExamineeRow,
  ExamineeScheduleRow,
  OperationScheduleRow,
  OperationScheduleScope,
} from "./examinees.types.js";

@Injectable()
export class ExamineesRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async listSchedules(access: AdmissionAccessPredicate) {
    const [rows] = await this.pool.execute<OperationScheduleRow[]>(
      `SELECT DATE_FORMAT(cr.exam_date, '%Y-%m-%d') AS date, cr.start_time AS time,
              cr.period_name AS periodName, cr.admission AS admissionName,
              GROUP_CONCAT(DISTINCT NULLIF(cr.building_name, '') ORDER BY cr.building_name SEPARATOR '\u001f') AS buildingNames,
              COUNT(*) AS candidateCount, COUNT(pa.id) AS assignedCount
       FROM candidate_record cr
       LEFT JOIN pseudonym_assignment pa ON pa.candidate_record_id = cr.id
       WHERE ${access.sql}
       GROUP BY cr.exam_date, cr.start_time, cr.period_name, cr.admission
       ORDER BY cr.exam_date, cr.start_time, cr.period_name, cr.admission`,
      access.params,
    );
    return rows.map((row) => ({
      ...row,
      buildingNames: row.buildingNames ? row.buildingNames.split("\u001f") : [],
      candidateCount: Number(row.candidateCount),
      assignedCount: Number(row.assignedCount),
    }));
  }

  async listRoster(scope: OperationScheduleScope, admissionName: string): Promise<ExamineeRow[]> {
    const [rows] = await this.pool.execute<ExamineeRow[]>(
      `${examineeSelectSql}
       WHERE cr.exam_date = ? AND cr.start_time = ? AND cr.period_name = ? AND cr.admission = ?
         AND e.status = 'ACTIVE'
       ORDER BY cr.designated_sort, cr.examinee_no`,
      [scope.date, scope.time, scope.periodName, admissionName],
    );
    return rows;
  }

  async findCurrent(examineeNo: string, scope: OperationScheduleScope, admissionName: string) {
    const [rows] = await this.pool.execute<ExamineeRow[]>(
      `${examineeSelectSql}
       WHERE cr.examinee_no = ? AND cr.exam_date = ? AND cr.start_time = ?
         AND cr.period_name = ? AND cr.admission = ? AND e.status = 'ACTIVE' LIMIT 1`,
      [examineeNo, scope.date, scope.time, scope.periodName, admissionName],
    );
    return rows[0] ?? null;
  }

  async listOtherSchedules(examineeNo: string, access: AdmissionAccessPredicate): Promise<ExamineeScheduleRow[]> {
    const [rows] = await this.pool.execute<ExamineeScheduleRow[]>(
      `SELECT cr.examinee_no AS examineeNo, cr.name,
              DATE_FORMAT(cr.exam_date, '%Y-%m-%d') AS examDate,
              TIME_FORMAT(cr.start_time, '%H:%i') AS examTime,
              cr.period_name AS periodName, cr.admission AS admissionName,
              cr.building_name AS buildingName, cr.room_name AS roomName
       FROM candidate_record cr
       INNER JOIN examinee e ON e.examinee_no = cr.examinee_no
       WHERE cr.examinee_no = ? AND e.status = 'ACTIVE' AND ${access.sql}
       ORDER BY cr.exam_date, cr.start_time, cr.period_name, cr.admission`,
      [examineeNo, ...access.params],
    );
    return rows;
  }

  async findPhoto(examineeNo: string, scope: OperationScheduleScope, admissionName: string) {
    const [rows] = await this.pool.execute<ExamineePhotoRow[]>(
      `SELECT cp.content, cp.mime_type AS mimeType
       FROM candidate_record cr
       INNER JOIN candidate_photo cp ON cp.candidate_record_id = cr.id
       WHERE cr.examinee_no = ? AND cr.exam_date = ? AND cr.start_time = ?
         AND cr.period_name = ? AND cr.admission = ? LIMIT 1`,
      [examineeNo, scope.date, scope.time, scope.periodName, admissionName],
    );
    return rows[0] ?? null;
  }
}

const examineeSelectSql = `SELECT cr.id, cr.examinee_no AS examineeNo, cr.name,
  DATE_FORMAT(cr.birth_date, '%Y-%m-%d') AS birthDate,
  DATE_FORMAT(cr.exam_date, '%Y-%m-%d') AS examDate,
  cr.room_name AS roomName, COALESCE(cr.designated_sort, '') AS seatNo,
  CONCAT('EX', cr.examinee_no) AS labelBarcode,
  NULLIF(cr.temporary_no, '') AS preassignedNumber,
  (cr.temporary_no <> '') AS preassignedAvailable,
  pa.pseudonym_no AS assignedNumber, pa.assignment_mode AS assignmentMode,
  pa.assigned_at AS assignedAt, COALESCE(pa.is_absentee, FALSE) AS absent, e.status,
  cr.start_time AS examTime, cr.end_time AS examEndTime,
  cr.period_name AS periodName, cr.period_code AS periodCode,
  cr.admission AS admissionName, cr.admission_code AS admissionCode,
  cr.unit_name AS unitName, cr.unit_code AS unitCode,
  cr.major AS majorName, cr.major_code AS majorCode,
  cr.building_name AS buildingName, cr.building_code AS buildingCode,
  cr.room_code AS roomCode, cr.group_name AS groupName,
  cr.opt1, cr.opt2, cr.opt3
 FROM candidate_record cr
 INNER JOIN examinee e ON e.examinee_no = cr.examinee_no
 LEFT JOIN pseudonym_assignment pa ON pa.candidate_record_id = cr.id`;
