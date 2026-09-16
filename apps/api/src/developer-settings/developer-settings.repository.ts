import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import type { ExamineeNoUniqueness, PseudonymNoUniqueness } from "../uniqueness/number-uniqueness.js";

export interface ProfileRow extends RowDataPacket {
  schoolName: string;
  academicYear: number;
  systemName: string;
  examineeNoUniqueness: ExamineeNoUniqueness;
  pseudonymNoUniqueness: PseudonymNoUniqueness;
  logoFileName: string | null;
  logoMimeType: string | null;
  logoData: Buffer | null;
  updatedAt: Date;
}

export interface DeveloperRow extends RowDataPacket {
  id: number;
  passwordHash: string | null;
}

interface ConflictCountRow extends RowDataPacket {
  conflictCount: number;
}

interface ProfileUpdate {
  schoolName: string;
  academicYear: number;
  systemName: string;
  examineeNoUniqueness: ExamineeNoUniqueness;
  pseudonymNoUniqueness: PseudonymNoUniqueness;
  updatedBy: number;
}

@Injectable()
export class DeveloperSettingsRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async getProfile(): Promise<ProfileRow | null> {
    const [rows] = await this.pool.query<ProfileRow[]>(profileSelectSql);
    return rows[0] ?? null;
  }

  async getHistoryResetPasswordConfigured() {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT history_reset_password_hash IS NOT NULL AS configured FROM system_profile WHERE id = 1",
    );
    return { configured: Boolean(rows[0]?.configured) };
  }

  updateHistoryResetPassword(connection: PoolConnection, passwordHash: string) {
    return connection.execute("UPDATE system_profile SET history_reset_password_hash = ? WHERE id = 1", [passwordHash]);
  }

  async getProfileForRead(executor: SqlExecutor): Promise<ProfileRow | null> {
    const [rows] = await executor.query<ProfileRow[]>(profileSelectSql);
    return rows[0] ?? null;
  }

  async getTargetProfileForRead(executor: SqlExecutor): Promise<ProfileRow | null> {
    const [rows] = await executor.query<ProfileRow[]>(targetProfileSelectSql);
    return rows[0] ?? null;
  }

  async lockProfile(connection: PoolConnection): Promise<ProfileRow | null> {
    const [rows] = await connection.execute<ProfileRow[]>(`${profileSelectSql} FOR UPDATE`);
    return rows[0] ?? null;
  }

  updateProfile(connection: PoolConnection, input: ProfileUpdate) {
    return connection.execute(
      `UPDATE system_profile
       SET school_name = ?, academic_year = ?, system_name = ?, examinee_no_uniqueness = ?,
           pseudonym_no_uniqueness = ?, updated_by = ?
       WHERE id = 1`,
      [
        input.schoolName,
        input.academicYear,
        input.systemName,
        input.examineeNoUniqueness,
        input.pseudonymNoUniqueness,
        input.updatedBy,
      ],
    );
  }

  updateLogo(
    connection: PoolConnection,
    input: { fileName: string; mimeType: string; data: Buffer; updatedBy: number },
  ) {
    return connection.execute(
      `UPDATE system_profile SET logo_file_name = ?, logo_mime_type = ?, logo_data = ?, updated_by = ? WHERE id = 1`,
      [input.fileName, input.mimeType, input.data, input.updatedBy],
    );
  }

  removeLogo(connection: PoolConnection, updatedBy: number) {
    return connection.execute(
      `UPDATE system_profile SET logo_file_name = NULL, logo_mime_type = NULL, logo_data = NULL, updated_by = ? WHERE id = 1`,
      [updatedBy],
    );
  }

  async findDeveloperForUpdate(connection: PoolConnection, userId: number): Promise<DeveloperRow | null> {
    const [rows] = await connection.execute<DeveloperRow[]>(
      `SELECT id, password_hash AS passwordHash FROM app_user
       WHERE id = ? AND role = 'DEVELOPER' AND enabled = TRUE LIMIT 1 FOR UPDATE`,
      [userId],
    );
    return rows[0] ?? null;
  }

  updateDeveloperPassword(connection: PoolConnection, developerId: number, passwordHash: string) {
    return connection.execute(
      `UPDATE app_user
       SET password_hash = ?, session_version = session_version + 1
       WHERE id = ?`,
      [passwordHash, developerId],
    );
  }

  countSystemExamineeNumberConflicts(connection: PoolConnection) {
    return this.readConflictCount(
      connection,
      `SELECT COUNT(*) AS conflictCount
       FROM (
         SELECT examinee_no
         FROM candidate_record
         GROUP BY examinee_no
         HAVING COUNT(*) > 1
       ) conflicts`,
    );
  }

  countScheduleIdentityConflicts(connection: PoolConnection) {
    return this.readConflictCount(
      connection,
      `SELECT COUNT(*) AS conflictCount
       FROM (
         SELECT examinee_no
         FROM candidate_record
         GROUP BY examinee_no
         HAVING COUNT(DISTINCT CONCAT_WS(CHAR(31), name, DATE_FORMAT(birth_date, '%Y-%m-%d'))) > 1
       ) conflicts`,
    );
  }

  countAdmissionPseudonymConflicts(connection: PoolConnection) {
    return this.readConflictCount(
      connection,
      `SELECT COUNT(*) AS conflictCount
       FROM (
         SELECT exam_name, admission_name, pseudonym_no
         FROM pseudonym_assignment
         GROUP BY exam_name, admission_name, pseudonym_no
         HAVING COUNT(*) > 1
       ) conflicts`,
    );
  }

  resetPseudonymScope(connection: PoolConnection) {
    return connection.execute("UPDATE pseudonym_assignment SET uniqueness_scope_key = ''");
  }

  rebuildPseudonymScheduleScope(connection: PoolConnection) {
    return connection.execute(
      `UPDATE pseudonym_assignment pa
       LEFT JOIN candidate_record cr ON cr.id = pa.candidate_record_id
       SET pa.uniqueness_scope_key = CASE
         WHEN cr.id IS NULL THEN ''
         ELSE SHA2(CONCAT_WS(CHAR(31), DATE_FORMAT(cr.exam_date, '%Y-%m-%d'), cr.start_time, cr.period_name, cr.admission), 256)
       END`,
    );
  }

  private async readConflictCount(connection: PoolConnection, sql: string): Promise<number> {
    const [rows] = await connection.query<ConflictCountRow[]>(sql);
    return Number(rows[0]?.conflictCount || 0);
  }
}

const profileSelectSql = `SELECT school_name AS schoolName, academic_year AS academicYear, system_name AS systemName,
  examinee_no_uniqueness AS examineeNoUniqueness,
  pseudonym_no_uniqueness AS pseudonymNoUniqueness,
  logo_file_name AS logoFileName, logo_mime_type AS logoMimeType, logo_data AS logoData,
  updated_at AS updatedAt
 FROM system_profile WHERE id = 1 LIMIT 1`;

const targetProfileSelectSql = `SELECT profile.school_name AS schoolName,
  cycle.academic_year AS academicYear, profile.system_name AS systemName,
  policy.examinee_scope AS examineeNoUniqueness,
  policy.pseudonym_scope AS pseudonymNoUniqueness,
  profile.logo_file_name AS logoFileName, profile.logo_mime_type AS logoMimeType,
  profile.logo_data AS logoData, profile.updated_at AS updatedAt
 FROM system_profile profile
 INNER JOIN exam_cycle cycle
   ON cycle.system_profile_id = profile.id AND cycle.status = 'ACTIVE'
 INNER JOIN number_uniqueness_policy policy ON policy.exam_cycle_id = cycle.id
 WHERE profile.id = 1
 ORDER BY cycle.id DESC LIMIT 1`;
