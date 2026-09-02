import { Injectable } from "@nestjs/common";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import {
  admissionIdentityKey,
  candidateClaimOwnerKey,
  candidateScheduleScopeKey,
  candidateSystemScopeKey,
  cycleCodeForAcademicYear,
  normalizeCandidateNumber,
  normalizeSourceCode,
  operationSlotIdentityKey,
  parseCanonicalPseudonymNumber,
  scheduleSegmentIdentityKey,
  sourceRowHash,
} from "../identity-transition/identity-keys.js";
import { normalizeIdentityText } from "../identity-transition/identity-normalization.js";

export type IdentityProjectionConflictCode =
  | "SOURCE_CANDIDATE_NOT_FOUND"
  | "ADMISSION_ALIAS_CONFLICT"
  | "CANDIDATE_PERSONAL_IDENTITY_CONFLICT"
  | "CANDIDATE_PHOTO_CONFLICT"
  | "REGISTRATION_SOURCE_CONFLICT"
  | "CANDIDATE_SLOT_CONFLICT"
  | "CANDIDATE_NUMBER_CLAIM_CONFLICT";

export class IdentityProjectionConflictError extends Error {
  constructor(
    readonly code: IdentityProjectionConflictCode,
    readonly entityType: string,
    readonly sourceId: number,
  ) {
    super(`Identity projection conflict: ${code}`);
    this.name = "IdentityProjectionConflictError";
  }
}

interface CandidateSourceRow extends RowDataPacket {
  id: number;
  sourceExamineeId: number | null;
  designatedSort: string;
  admission: string;
  admissionCode: string;
  unitName: string;
  unitCode: string;
  major: string;
  majorCode: string;
  examDate: string;
  startTime: string;
  endTime: string;
  periodName: string;
  periodCode: string;
  buildingName: string;
  buildingCode: string;
  roomName: string;
  roomCode: string;
  examineeNo: string;
  temporaryNo: string;
  name: string;
  birthDate: string;
  groupName: string;
  opt1: string;
  opt2: string;
  opt3: string;
}

interface SystemProfileRow extends RowDataPacket {
  academicYear: number;
  examineeScope: "SYSTEM" | "SCHEDULE";
  pseudonymScope: "ADMISSION" | "SCHEDULE";
  updatedBy: number | null;
}

interface ExistingCandidateRow extends RowDataPacket {
  id: number;
  name: string;
  birthDate: string;
}

interface ExistingRegistrationRow extends RowDataPacket {
  id: number;
  candidateId: number;
  scheduleSegmentId: number;
}

interface ExistingSlotClaimRow extends RowDataPacket {
  registrationId: number;
}

interface ExistingAdmissionAliasRow extends RowDataPacket {
  admissionId: number;
}

interface ExistingAdmissionRow extends RowDataPacket {
  id: number;
  sourceCode: string | null;
  canonicalName: string;
  identityKey: Buffer;
}

interface ExistingOperationSlotRow extends RowDataPacket {
  id: number;
  periodCode: string | null;
  periodName: string;
  periodCanonicalName: string;
}

interface ExistingScheduleSegmentRow extends RowDataPacket {
  id: number;
  unitCode: string | null;
  unitName: string;
  majorCode: string | null;
  majorName: string;
  buildingCode: string | null;
  buildingName: string;
  roomCode: string | null;
  roomName: string;
}

interface ExistingCandidateNumberClaimRow extends RowDataPacket {
  candidateId: number;
  ownerKey: Buffer;
}

interface ExistingCandidatePhotoRow extends RowDataPacket {
  candidateId: number;
  sourceCandidateRecordId: number | null;
  contentHash: string;
}

export interface CandidateIdentityProjection {
  examCycleId: number;
  admissionId: number;
  operationSlotId: number;
  scheduleSegmentId: number;
  candidateId: number;
  registrationId: number;
}

@Injectable()
export class CandidateIdentityRepository {
  async syncCandidateRecord(
    executor: SqlExecutor,
    sourceCandidateRecordId: number,
    examName: string,
  ): Promise<CandidateIdentityProjection> {
    const source = await this.loadSource(executor, sourceCandidateRecordId, examName);
    if (!source) {
      throw new IdentityProjectionConflictError(
        "SOURCE_CANDIDATE_NOT_FOUND",
        "candidate_record",
        sourceCandidateRecordId,
      );
    }
    const profile = await this.loadSystemProfile(executor);
    const examCycleId = await this.resolveExamCycle(executor, profile, examName);
    await this.syncNumberPolicy(executor, examCycleId, profile);
    const admissionId = await this.resolveAdmission(executor, examCycleId, source);
    const operationSlotId = await this.resolveOperationSlot(executor, admissionId, source);
    const scheduleSegmentId = await this.resolveScheduleSegment(executor, operationSlotId, source);
    const candidateId = await this.resolveCandidate(executor, examCycleId, source);
    const registrationId = await this.resolveRegistration(executor, candidateId, scheduleSegmentId, source);
    await this.ensureSlotClaim(executor, registrationId, candidateId, operationSlotId, source.id);
    await this.ensureCandidateNumberClaim(executor, {
      examCycleId,
      operationSlotId,
      candidateId,
      registrationId,
      examineeNoCanonical: normalizeCandidateNumber(source.examineeNo),
      scopeKind: profile.examineeScope,
      sourceId: source.id,
    });
    return { examCycleId, admissionId, operationSlotId, scheduleSegmentId, candidateId, registrationId };
  }

  async syncCandidatePhoto(executor: SqlExecutor, sourceCandidateRecordId: number): Promise<void> {
    const [rows] = await executor.execute<
      Array<
        RowDataPacket & {
          candidateId: number;
          fileName: string;
          mimeType: string;
          content: Buffer;
          contentHash: string;
        }
      >
    >(
      `SELECT c.id AS candidateId, cp.file_name AS fileName, cp.mime_type AS mimeType,
              cp.content, cp.content_hash AS contentHash
       FROM candidate_registration registration
       INNER JOIN candidate c ON c.id = registration.candidate_id
       INNER JOIN candidate_photo cp ON cp.candidate_record_id = registration.source_candidate_record_id
       WHERE registration.source_candidate_record_id = ? LIMIT 1`,
      [sourceCandidateRecordId],
    );
    const row = rows[0];
    if (!row) return;
    const [existingRows] = await executor.execute<ExistingCandidatePhotoRow[]>(
      `SELECT candidate_id AS candidateId, source_candidate_record_id AS sourceCandidateRecordId,
              content_hash AS contentHash
       FROM candidate_identity_photo WHERE candidate_id = ? LIMIT 1 FOR UPDATE`,
      [row.candidateId],
    );
    const existing = existingRows[0];
    const [sourceOwnerRows] = await executor.execute<ExistingCandidatePhotoRow[]>(
      `SELECT candidate_id AS candidateId, source_candidate_record_id AS sourceCandidateRecordId,
              content_hash AS contentHash
       FROM candidate_identity_photo WHERE source_candidate_record_id = ? LIMIT 1 FOR UPDATE`,
      [sourceCandidateRecordId],
    );
    const sourceOwner = sourceOwnerRows[0];
    if (
      (sourceOwner && Number(sourceOwner.candidateId) !== Number(row.candidateId)) ||
      (existing &&
        Number(existing.sourceCandidateRecordId ?? 0) !== sourceCandidateRecordId &&
        existing.contentHash !== row.contentHash)
    ) {
      throw new IdentityProjectionConflictError("CANDIDATE_PHOTO_CONFLICT", "candidate_photo", sourceCandidateRecordId);
    }
    try {
      await executor.execute(
        `INSERT INTO candidate_identity_photo
          (candidate_id, source_candidate_record_id, file_name, mime_type, content, content_hash)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE source_candidate_record_id = COALESCE(source_candidate_record_id, VALUES(source_candidate_record_id)),
           file_name = VALUES(file_name), mime_type = VALUES(mime_type),
           content = VALUES(content), content_hash = VALUES(content_hash)`,
        [row.candidateId, sourceCandidateRecordId, row.fileName, row.mimeType, row.content, row.contentHash],
      );
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new IdentityProjectionConflictError(
          "CANDIDATE_PHOTO_CONFLICT",
          "candidate_photo",
          sourceCandidateRecordId,
        );
      }
      throw error;
    }
  }

  private async loadSource(
    executor: SqlExecutor,
    sourceCandidateRecordId: number,
    examName: string,
  ): Promise<CandidateSourceRow | null> {
    const [rows] = await executor.execute<CandidateSourceRow[]>(
      `SELECT cr.id, e.id AS sourceExamineeId, cr.designated_sort AS designatedSort,
              cr.admission, cr.admission_code AS admissionCode,
              cr.unit_name AS unitName, cr.unit_code AS unitCode,
              cr.major, cr.major_code AS majorCode,
              DATE_FORMAT(cr.exam_date, '%Y-%m-%d') AS examDate,
              cr.start_time AS startTime, cr.end_time AS endTime,
              cr.period_name AS periodName, cr.period_code AS periodCode,
              cr.building_name AS buildingName, cr.building_code AS buildingCode,
              cr.room_name AS roomName, cr.room_code AS roomCode,
              cr.examinee_no AS examineeNo, cr.temporary_no AS temporaryNo,
              cr.name, DATE_FORMAT(cr.birth_date, '%Y-%m-%d') AS birthDate,
              cr.group_name AS groupName, cr.opt1, cr.opt2, cr.opt3
       FROM candidate_record cr
       LEFT JOIN examinee e ON e.examinee_no = cr.examinee_no AND e.exam_name = ?
       WHERE cr.id = ? LIMIT 1`,
      [examName, sourceCandidateRecordId],
    );
    return rows[0] ?? null;
  }

  private async loadSystemProfile(executor: SqlExecutor): Promise<SystemProfileRow> {
    const [rows] = await executor.query<SystemProfileRow[]>(
      `SELECT academic_year AS academicYear,
              examinee_no_uniqueness AS examineeScope,
              pseudonym_no_uniqueness AS pseudonymScope,
              updated_by AS updatedBy
       FROM system_profile WHERE id = 1 LIMIT 1 LOCK IN SHARE MODE`,
    );
    const row = rows[0];
    if (!row) throw new Error("System profile is missing.");
    return row;
  }

  private async resolveExamCycle(executor: SqlExecutor, profile: SystemProfileRow, examName: string): Promise<number> {
    const [result] = await executor.execute<ResultSetHeader>(
      `INSERT INTO exam_cycle
        (system_profile_id, cycle_code, display_name, academic_year, status, created_by, updated_by)
       VALUES (1, ?, ?, ?, 'ACTIVE', ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), display_name = VALUES(display_name),
         academic_year = VALUES(academic_year), status = 'ACTIVE', updated_by = VALUES(updated_by)`,
      [
        cycleCodeForAcademicYear(Number(profile.academicYear)),
        examName,
        Number(profile.academicYear),
        profile.updatedBy,
        profile.updatedBy,
      ],
    );
    return requiredInsertId(result, "exam cycle");
  }

  private async syncNumberPolicy(executor: SqlExecutor, examCycleId: number, profile: SystemProfileRow): Promise<void> {
    await executor.execute(
      `INSERT INTO number_uniqueness_policy
        (exam_cycle_id, examinee_scope, pseudonym_scope, updated_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE examinee_scope = VALUES(examinee_scope),
         pseudonym_scope = VALUES(pseudonym_scope), updated_by = VALUES(updated_by)`,
      [examCycleId, profile.examineeScope, profile.pseudonymScope, profile.updatedBy],
    );
  }

  private async resolveAdmission(
    executor: SqlExecutor,
    examCycleId: number,
    source: CandidateSourceRow,
  ): Promise<number> {
    const sourceCode = normalizeSourceCode(source.admissionCode);
    const canonicalName = normalizeRequiredText(source.admission, "admission", source.id);
    const displayName = normalizeIdentityText(source.admission);
    const nameIdentityKey = admissionIdentityKey(null, canonicalName);
    const codeIdentityKey = sourceCode ? admissionIdentityKey(sourceCode, canonicalName) : null;
    const aliasKeys = codeIdentityKey ? [codeIdentityKey, nameIdentityKey] : [nameIdentityKey];

    // Alias resolution must precede admission insertion. Otherwise a later source code
    // would create a second admission before the original name identity can be found.
    const [aliases] = await executor.execute<ExistingAdmissionAliasRow[]>(
      `SELECT admission_id AS admissionId
       FROM admission_identity_alias
       WHERE exam_cycle_id = ? AND alias_key IN (${sqlPlaceholders(aliasKeys.length)})
       ORDER BY admission_id FOR UPDATE`,
      [examCycleId, ...aliasKeys],
    );
    const aliasAdmissionIds = distinctPositiveIds(aliases.map((alias) => alias.admissionId));
    if (aliasAdmissionIds.length > 1) throw admissionAliasConflict(source.id);

    const admissionClauses = [`identity_key IN (${sqlPlaceholders(aliasKeys.length)})`];
    const admissionParameters: Array<Buffer | number | string> = [examCycleId, ...aliasKeys];
    if (sourceCode) {
      admissionClauses.push("source_code = ?", "(source_code IS NULL AND canonical_name = ?)");
      admissionParameters.push(sourceCode, canonicalName);
    } else {
      // This also recovers code-based rows created before NAME aliases were enriched.
      admissionClauses.push("canonical_name = ?");
      admissionParameters.push(canonicalName);
    }
    if (aliasAdmissionIds[0]) {
      admissionClauses.push("id = ?");
      admissionParameters.push(aliasAdmissionIds[0]);
    }
    const [admissions] = await executor.execute<ExistingAdmissionRow[]>(
      `SELECT id, source_code AS sourceCode, canonical_name AS canonicalName,
              identity_key AS identityKey
       FROM admission
       WHERE exam_cycle_id = ? AND (${admissionClauses.join(" OR ")})
       ORDER BY id FOR UPDATE`,
      admissionParameters,
    );
    const admissionIds = distinctPositiveIds([...aliasAdmissionIds, ...admissions.map((admission) => admission.id)]);
    if (admissionIds.length > 1) throw admissionAliasConflict(source.id);

    let admissionId = admissionIds[0] ?? null;
    const existing = admissionId ? admissions.find((admission) => Number(admission.id) === admissionId) : undefined;
    if (admissionId && !existing) throw admissionAliasConflict(source.id);
    const existingSourceCode = normalizeSourceCode(existing?.sourceCode);
    if (existingSourceCode && sourceCode && existingSourceCode !== sourceCode) {
      throw admissionAliasConflict(source.id);
    }
    const effectiveSourceCode = existingSourceCode ?? sourceCode;
    const targetIdentityKey = admissionIdentityKey(effectiveSourceCode, canonicalName);

    try {
      if (admissionId) {
        await executor.execute(
          `UPDATE admission
           SET source_code = ?, display_name = ?, canonical_name = ?, identity_key = ?, status = 'ACTIVE'
           WHERE id = ? AND exam_cycle_id = ?`,
          [effectiveSourceCode, displayName, canonicalName, targetIdentityKey, admissionId, examCycleId],
        );
      } else {
        const [result] = await executor.execute<ResultSetHeader>(
          `INSERT INTO admission
            (exam_cycle_id, source_code, display_name, canonical_name, identity_key)
           VALUES (?, ?, ?, ?, ?)`,
          [examCycleId, effectiveSourceCode, displayName, canonicalName, targetIdentityKey],
        );
        admissionId = requiredInsertId(result, "admission");
      }
    } catch (error) {
      if (isDuplicateEntry(error)) throw admissionAliasConflict(source.id);
      throw error;
    }

    await this.ensureAdmissionAlias(
      executor,
      examCycleId,
      admissionId,
      "NAME",
      canonicalName,
      nameIdentityKey,
      source.id,
    );
    if (effectiveSourceCode) {
      await this.ensureAdmissionAlias(
        executor,
        examCycleId,
        admissionId,
        "CODE",
        effectiveSourceCode,
        admissionIdentityKey(effectiveSourceCode, canonicalName),
        source.id,
      );
    }
    return admissionId;
  }

  private async ensureAdmissionAlias(
    executor: SqlExecutor,
    examCycleId: number,
    admissionId: number,
    aliasType: "CODE" | "NAME",
    aliasValue: string,
    aliasKey: Buffer,
    sourceId: number,
  ): Promise<void> {
    try {
      await executor.execute(
        `INSERT INTO admission_identity_alias
          (exam_cycle_id, admission_id, alias_type, alias_value, alias_key)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [examCycleId, admissionId, aliasType, aliasValue, aliasKey],
      );
    } catch (error) {
      if (isDuplicateEntry(error)) throw admissionAliasConflict(sourceId);
      throw error;
    }
    const [rows] = await executor.execute<ExistingAdmissionAliasRow[]>(
      `SELECT admission_id AS admissionId
       FROM admission_identity_alias
       WHERE exam_cycle_id = ? AND alias_key = ? LIMIT 1 FOR UPDATE`,
      [examCycleId, aliasKey],
    );
    if (!rows[0] || Number(rows[0].admissionId) !== admissionId) {
      throw admissionAliasConflict(sourceId);
    }
  }

  private async resolveOperationSlot(
    executor: SqlExecutor,
    admissionId: number,
    source: CandidateSourceRow,
  ): Promise<number> {
    const periodCode = normalizeSourceCode(source.periodCode);
    const periodName = normalizeRequiredText(source.periodName, "period", source.id);
    const startTime = normalizeDatabaseTime(source.startTime);
    const [rows] = await executor.execute<ExistingOperationSlotRow[]>(
      `SELECT id, period_code AS periodCode, period_name AS periodName,
              period_canonical_name AS periodCanonicalName
       FROM operation_slot
       WHERE admission_id = ? AND exam_date = ? AND start_time = ?
       ORDER BY id FOR UPDATE`,
      [admissionId, source.examDate, startTime],
    );
    const resolution = resolveCodedIdentityRows(rows, {
      code: periodCode,
      canonicalName: periodName,
      readCode: (row) => row.periodCode,
      readName: (row) => row.periodCanonicalName || row.periodName,
    });
    if (resolution.conflicting || resolution.matches.length > 1) {
      throw registrationSourceConflict("operation_slot", source.id);
    }
    const existing = resolution.matches[0];
    const effectivePeriodCode = normalizeSourceCode(existing?.periodCode) ?? periodCode;
    const identityKey = operationSlotIdentityKey({
      examDate: source.examDate,
      startTime,
      periodCode: effectivePeriodCode,
      periodName,
    });
    const values = [
      normalizeOptionalDatabaseTime(source.endTime),
      effectivePeriodCode,
      normalizeIdentityText(source.periodName),
      periodName,
      identityKey,
    ];
    try {
      if (existing) {
        await executor.execute(
          `UPDATE operation_slot
           SET end_time = NULLIF(?, ''), period_code = ?, period_name = ?,
               period_canonical_name = ?, identity_key = ?, status = 'ACTIVE'
           WHERE id = ?`,
          [...values, existing.id],
        );
        return requiredPositiveId(existing.id, "operation slot");
      }
      const [result] = await executor.execute<ResultSetHeader>(
        `INSERT INTO operation_slot
          (admission_id, exam_date, start_time, end_time, period_code, period_name,
           period_canonical_name, identity_key)
         VALUES (?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?)`,
        [admissionId, source.examDate, startTime, ...values],
      );
      return requiredInsertId(result, "operation slot");
    } catch (error) {
      if (isDuplicateEntry(error)) throw registrationSourceConflict("operation_slot", source.id);
      throw error;
    }
  }

  private async resolveScheduleSegment(
    executor: SqlExecutor,
    operationSlotId: number,
    source: CandidateSourceRow,
  ): Promise<number> {
    const incoming = segmentIdentity(source);
    const [rows] = await executor.execute<ExistingScheduleSegmentRow[]>(
      `SELECT id, unit_code AS unitCode, unit_name AS unitName,
              major_code AS majorCode, major_name AS majorName,
              building_code AS buildingCode, building_name AS buildingName,
              room_code AS roomCode, room_name AS roomName
       FROM schedule_segment
       WHERE operation_slot_id = ?
       ORDER BY id FOR UPDATE`,
      [operationSlotId],
    );
    const resolution = resolveScheduleSegmentRows(rows, incoming);
    if (resolution.conflicting || resolution.matches.length > 1) {
      throw registrationSourceConflict("schedule_segment", source.id);
    }
    const existing = resolution.matches[0];
    const effective = mergeSegmentCodes(existing, incoming);
    const identityKey = scheduleSegmentIdentityKey(effective);
    const values = [
      effective.unitCode,
      incoming.unitName,
      effective.majorCode,
      incoming.majorName,
      effective.buildingCode,
      incoming.buildingName,
      effective.roomCode,
      incoming.roomName,
      identityKey,
    ];
    try {
      if (existing) {
        await executor.execute(
          `UPDATE schedule_segment
           SET unit_code = ?, unit_name = ?, major_code = ?, major_name = ?,
               building_code = ?, building_name = ?, room_code = ?, room_name = ?,
               identity_key = ?, status = 'ACTIVE'
           WHERE id = ?`,
          [...values, existing.id],
        );
        return requiredPositiveId(existing.id, "schedule segment");
      }
      const [result] = await executor.execute<ResultSetHeader>(
        `INSERT INTO schedule_segment
          (operation_slot_id, unit_code, unit_name, major_code, major_name,
           building_code, building_name, room_code, room_name, identity_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [operationSlotId, ...values],
      );
      return requiredInsertId(result, "schedule segment");
    } catch (error) {
      if (isDuplicateEntry(error)) throw registrationSourceConflict("schedule_segment", source.id);
      throw error;
    }
  }

  private async resolveCandidate(
    executor: SqlExecutor,
    examCycleId: number,
    source: CandidateSourceRow,
  ): Promise<number> {
    const canonicalNumber = normalizeCandidateNumber(source.examineeNo);
    const canonicalName = normalizeIdentityText(source.name);
    const [rows] = await executor.execute<ExistingCandidateRow[]>(
      `SELECT id, name, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birthDate
       FROM candidate
       WHERE exam_cycle_id = ? AND examinee_no_canonical = ?
       LIMIT 1 FOR UPDATE`,
      [examCycleId, canonicalNumber],
    );
    const existing = rows[0];
    const hash = sourceRowHash("candidate", [canonicalNumber, canonicalName, source.birthDate]);
    if (existing) {
      if (normalizeIdentityText(existing.name) !== canonicalName || existing.birthDate !== source.birthDate) {
        throw new IdentityProjectionConflictError(
          "CANDIDATE_PERSONAL_IDENTITY_CONFLICT",
          "candidate_record",
          source.id,
        );
      }
      await executor.execute(
        `UPDATE candidate SET examinee_no_display = ?, name = ?, source_hash = ?,
           source_examinee_id = COALESCE(source_examinee_id, ?), status = 'ACTIVE'
         WHERE id = ?`,
        [source.examineeNo, source.name, hash, source.sourceExamineeId, existing.id],
      );
      return Number(existing.id);
    }
    const [result] = await executor.execute<ResultSetHeader>(
      `INSERT INTO candidate
        (exam_cycle_id, source_examinee_id, examinee_no_display, examinee_no_canonical,
         name, birth_date, source_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [examCycleId, source.sourceExamineeId, source.examineeNo, canonicalNumber, source.name, source.birthDate, hash],
    );
    return requiredInsertId(result, "candidate");
  }

  private async resolveRegistration(
    executor: SqlExecutor,
    candidateId: number,
    scheduleSegmentId: number,
    source: CandidateSourceRow,
  ): Promise<number> {
    const [rows] = await executor.execute<ExistingRegistrationRow[]>(
      `SELECT id, candidate_id AS candidateId, schedule_segment_id AS scheduleSegmentId
       FROM candidate_registration WHERE source_candidate_record_id = ? LIMIT 1 FOR UPDATE`,
      [source.id],
    );
    const existing = rows[0];
    if (
      existing &&
      (Number(existing.candidateId) !== candidateId || Number(existing.scheduleSegmentId) !== scheduleSegmentId)
    ) {
      throw new IdentityProjectionConflictError("REGISTRATION_SOURCE_CONFLICT", "candidate_record", source.id);
    }
    const preassigned = parseCanonicalPseudonymNumber(source.temporaryNo);
    const hash = sourceRowHash("registration", [
      candidateId,
      scheduleSegmentId,
      source.designatedSort,
      source.groupName,
      source.opt1,
      source.opt2,
      source.opt3,
      preassigned?.value ?? null,
      preassigned?.displayWidth ?? null,
    ]);
    const values = [
      source.designatedSort,
      source.groupName,
      source.opt1,
      source.opt2,
      source.opt3,
      preassigned?.value ?? null,
      preassigned?.displayWidth ?? null,
      hash,
    ];
    if (existing) {
      await executor.execute(
        `UPDATE candidate_registration
         SET designated_sort = ?, group_name = ?, opt1 = ?, opt2 = ?, opt3 = ?,
             preassigned_value = ?, preassigned_display_width = ?, source_hash = ?, status = 'ACTIVE'
         WHERE id = ?`,
        [...values, existing.id],
      );
      return Number(existing.id);
    }
    try {
      const [result] = await executor.execute<ResultSetHeader>(
        `INSERT INTO candidate_registration
          (candidate_id, schedule_segment_id, source_candidate_record_id, designated_sort,
           group_name, opt1, opt2, opt3, preassigned_value, preassigned_display_width, source_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [candidateId, scheduleSegmentId, source.id, ...values],
      );
      return requiredInsertId(result, "candidate registration");
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new IdentityProjectionConflictError("REGISTRATION_SOURCE_CONFLICT", "candidate_record", source.id);
      }
      throw error;
    }
  }

  private async ensureSlotClaim(
    executor: SqlExecutor,
    registrationId: number,
    candidateId: number,
    operationSlotId: number,
    sourceId: number,
  ): Promise<void> {
    const [rows] = await executor.execute<ExistingSlotClaimRow[]>(
      `SELECT registration_id AS registrationId
       FROM candidate_registration_slot_claim
       WHERE candidate_id = ? AND operation_slot_id = ? LIMIT 1 FOR UPDATE`,
      [candidateId, operationSlotId],
    );
    if (rows[0] && Number(rows[0].registrationId) !== registrationId) {
      throw new IdentityProjectionConflictError("CANDIDATE_SLOT_CONFLICT", "candidate_record", sourceId);
    }
    await executor.execute(
      `INSERT INTO candidate_registration_slot_claim (registration_id, candidate_id, operation_slot_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE candidate_id = VALUES(candidate_id), operation_slot_id = VALUES(operation_slot_id)`,
      [registrationId, candidateId, operationSlotId],
    );
  }

  private async ensureCandidateNumberClaim(
    executor: SqlExecutor,
    input: {
      examCycleId: number;
      operationSlotId: number;
      candidateId: number;
      registrationId: number;
      examineeNoCanonical: string;
      scopeKind: "SYSTEM" | "SCHEDULE";
      sourceId: number;
    },
  ): Promise<void> {
    const scheduleScoped = input.scopeKind === "SCHEDULE";
    const scopeKey = scheduleScoped
      ? candidateScheduleScopeKey(input.operationSlotId)
      : candidateSystemScopeKey(input.examCycleId);
    const ownerKey = candidateClaimOwnerKey({
      scopeKind: input.scopeKind,
      candidateId: input.candidateId,
      ...(scheduleScoped ? { registrationId: input.registrationId } : {}),
    });
    const [ownerRows] = await executor.execute<ExistingCandidateNumberClaimRow[]>(
      `SELECT candidate_id AS candidateId, owner_key AS ownerKey
       FROM candidate_number_claim WHERE owner_key = ? LIMIT 1 FOR UPDATE`,
      [ownerKey],
    );
    const [numberRows] = await executor.execute<ExistingCandidateNumberClaimRow[]>(
      `SELECT candidate_id AS candidateId, owner_key AS ownerKey
       FROM candidate_number_claim
       WHERE scope_key = ? AND examinee_no_canonical = ? LIMIT 1 FOR UPDATE`,
      [scopeKey, input.examineeNoCanonical],
    );
    const ownerClaim = ownerRows[0];
    const numberClaim = numberRows[0];
    if (
      (ownerClaim && Number(ownerClaim.candidateId) !== input.candidateId) ||
      (numberClaim && !numberClaim.ownerKey.equals(ownerKey))
    ) {
      throw new IdentityProjectionConflictError("CANDIDATE_NUMBER_CLAIM_CONFLICT", "candidate_record", input.sourceId);
    }
    try {
      await executor.execute(
        `INSERT INTO candidate_number_claim
          (candidate_id, registration_id, scope_kind, exam_cycle_id, operation_slot_id,
           scope_key, owner_key, examinee_no_canonical)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE candidate_id = VALUES(candidate_id), registration_id = VALUES(registration_id),
           scope_kind = VALUES(scope_kind), exam_cycle_id = VALUES(exam_cycle_id),
           operation_slot_id = VALUES(operation_slot_id), scope_key = VALUES(scope_key),
           examinee_no_canonical = VALUES(examinee_no_canonical)`,
        [
          input.candidateId,
          scheduleScoped ? input.registrationId : null,
          input.scopeKind,
          input.examCycleId,
          scheduleScoped ? input.operationSlotId : null,
          scopeKey,
          ownerKey,
          input.examineeNoCanonical,
        ],
      );
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new IdentityProjectionConflictError(
          "CANDIDATE_NUMBER_CLAIM_CONFLICT",
          "candidate_record",
          input.sourceId,
        );
      }
      throw error;
    }
  }
}

function requiredInsertId(result: ResultSetHeader, entity: string): number {
  return requiredPositiveId(result.insertId, entity);
}

function requiredPositiveId(value: unknown, entity: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Could not resolve target ${entity}.`);
  return id;
}

function distinctPositiveIds(values: readonly unknown[]): number[] {
  return [...new Set(values.map((value) => requiredPositiveId(value, "identity")))];
}

function sqlPlaceholders(count: number): string {
  if (!Number.isSafeInteger(count) || count <= 0) throw new Error("Identity lookup requires a key.");
  return Array.from({ length: count }, () => "?").join(", ");
}

type CodedIdentityClassification = "MATCH" | "CONFLICT" | "DIFFERENT";

function classifyCodedIdentity(
  existingCodeValue: string | null,
  existingNameValue: string,
  incomingCode: string | null,
  incomingCanonicalName: string,
): CodedIdentityClassification {
  const existingCode = normalizeSourceCode(existingCodeValue);
  const existingCanonicalName = normalizeIdentityText(existingNameValue);
  if (existingCode && incomingCode) {
    if (existingCode === incomingCode) return "MATCH";
    return existingCanonicalName === incomingCanonicalName ? "CONFLICT" : "DIFFERENT";
  }
  return existingCanonicalName === incomingCanonicalName ? "MATCH" : "DIFFERENT";
}

function resolveCodedIdentityRows<T>(
  rows: readonly T[],
  input: {
    code: string | null;
    canonicalName: string;
    readCode: (row: T) => string | null;
    readName: (row: T) => string;
  },
): { matches: T[]; conflicting: boolean } {
  const matches: T[] = [];
  let conflicting = false;
  for (const row of rows) {
    const classification = classifyCodedIdentity(
      input.readCode(row),
      input.readName(row),
      input.code,
      input.canonicalName,
    );
    if (classification === "MATCH") matches.push(row);
    if (classification === "CONFLICT") conflicting = true;
  }
  return { matches, conflicting };
}

interface SegmentIdentityValue {
  unitCode: string | null;
  unitName: string;
  majorCode: string | null;
  majorName: string;
  buildingCode: string | null;
  buildingName: string;
  roomCode: string | null;
  roomName: string;
}

function segmentIdentity(source: CandidateSourceRow): SegmentIdentityValue {
  return {
    unitCode: normalizeSourceCode(source.unitCode),
    unitName: normalizeIdentityText(source.unitName),
    majorCode: normalizeSourceCode(source.majorCode),
    majorName: normalizeIdentityText(source.major),
    buildingCode: normalizeSourceCode(source.buildingCode),
    buildingName: normalizeIdentityText(source.buildingName),
    roomCode: normalizeSourceCode(source.roomCode),
    roomName: normalizeIdentityText(source.roomName),
  };
}

function resolveScheduleSegmentRows(
  rows: readonly ExistingScheduleSegmentRow[],
  incoming: SegmentIdentityValue,
): { matches: ExistingScheduleSegmentRow[]; conflicting: boolean } {
  const matches: ExistingScheduleSegmentRow[] = [];
  let conflicting = false;
  for (const row of rows) {
    const dimensions = [
      classifyCodedIdentity(row.unitCode, row.unitName, incoming.unitCode, incoming.unitName),
      classifyCodedIdentity(row.majorCode, row.majorName, incoming.majorCode, incoming.majorName),
      classifyCodedIdentity(row.buildingCode, row.buildingName, incoming.buildingCode, incoming.buildingName),
      classifyCodedIdentity(row.roomCode, row.roomName, incoming.roomCode, incoming.roomName),
    ];
    if (dimensions.every((classification) => classification === "MATCH")) {
      matches.push(row);
    } else if (
      dimensions.every((classification) => classification !== "DIFFERENT") &&
      dimensions.some((classification) => classification === "CONFLICT")
    ) {
      conflicting = true;
    }
  }
  return { matches, conflicting };
}

function mergeSegmentCodes(
  existing: ExistingScheduleSegmentRow | undefined,
  incoming: SegmentIdentityValue,
): SegmentIdentityValue {
  return {
    ...incoming,
    unitCode: normalizeSourceCode(existing?.unitCode) ?? incoming.unitCode,
    majorCode: normalizeSourceCode(existing?.majorCode) ?? incoming.majorCode,
    buildingCode: normalizeSourceCode(existing?.buildingCode) ?? incoming.buildingCode,
    roomCode: normalizeSourceCode(existing?.roomCode) ?? incoming.roomCode,
  };
}

function admissionAliasConflict(sourceId: number): IdentityProjectionConflictError {
  return new IdentityProjectionConflictError("ADMISSION_ALIAS_CONFLICT", "candidate_record", sourceId);
}

function registrationSourceConflict(entityType: string, sourceId: number): IdentityProjectionConflictError {
  return new IdentityProjectionConflictError("REGISTRATION_SOURCE_CONFLICT", entityType, sourceId);
}

function normalizeRequiredText(value: string, entity: string, sourceId: number): string {
  const normalized = normalizeIdentityText(value);
  if (!normalized) {
    throw new IdentityProjectionConflictError("REGISTRATION_SOURCE_CONFLICT", entity, sourceId);
  }
  return normalized;
}

function normalizeDatabaseTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

function normalizeOptionalDatabaseTime(value: string): string {
  return value ? normalizeDatabaseTime(value) : "";
}

function isDuplicateEntry(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ER_DUP_ENTRY");
}
