import { Injectable } from "@nestjs/common";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { MutationAuditEventType } from "../common/audit/mutation-audit.contract.js";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import type { IdentityShadowReport } from "./identity-shadow.js";

const UINT32_MAX = 4_294_967_295;
const OBSERVATION_TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const IDENTITY_SOURCE_MUTATION_AUDIT_EVENT_TYPES = [
  "ACCOUNT_CREATED",
  "ACCOUNT_UPDATED",
  "ACCOUNT_DELETED",
  "CANDIDATE_WORKBOOK_IMPORTED",
  "CANDIDATE_PHOTO_ARCHIVE_IMPORTED",
  "SYSTEM_PROFILE_UPDATED",
  "WORKSTATION_CREATED",
  "FORM_TEMPLATE_SAVED",
  "FORM_TEMPLATE_METADATA_UPDATED",
  "PSEUDONYM_SETTING_UPDATED",
  "PSEUDONYM_OPERATION_CLOSED",
  "PSEUDONYM_OPERATION_REOPENED",
  "PSEUDONYM_ASSIGNED",
  "PRINT_JOB_CREATED",
  "PRINT_JOB_SENT",
  "PRINT_JOB_FAILED",
  "PRINT_JOB_EXPIRED",
  "PRINT_JOB_REISSUED",
] as const satisfies readonly MutationAuditEventType[];

interface HighWaterMarkRow extends RowDataPacket {
  sourceHighWaterMark: number | string;
}

export interface IdentityShadowObservation {
  verificationBatchId?: string;
  observationType: string;
  sourceHighWaterMark: number;
  report: IdentityShadowReport;
}

@Injectable()
export class IdentityShadowObservationRepository {
  async loadSourceMutationHighWaterMark(executor: SqlExecutor): Promise<number> {
    const [rows] = await executor.query<HighWaterMarkRow[]>(
      `SELECT sequence AS sourceHighWaterMark
       FROM identity_source_mutation_watermark WHERE id = 1`,
    );
    const sourceHighWaterMark = Number(rows[0]?.sourceHighWaterMark ?? -1);
    if (!Number.isSafeInteger(sourceHighWaterMark) || sourceHighWaterMark < 0) {
      throw new Error("Identity source mutation audit high-water mark is invalid.");
    }
    return sourceHighWaterMark;
  }

  async startBatch(executor: SqlExecutor, batchId: string): Promise<void> {
    assertBatchId(batchId);
    await executor.execute(
      `INSERT INTO identity_shadow_verification_batch (id, status, observation_count)
       VALUES (?, 'RUNNING', 0)`,
      [batchId],
    );
  }

  async record(executor: SqlExecutor, observation: IdentityShadowObservation): Promise<void> {
    assertObservation(observation);
    const { report } = observation;
    await executor.execute(
      `INSERT INTO identity_shadow_observation (
         verification_batch_id, observation_type, source_high_water_mark, old_row_count, new_row_count,
         match_count, mismatch_count, old_only_count, new_only_count, ambiguous_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        observation.verificationBatchId ?? null,
        observation.observationType,
        observation.sourceHighWaterMark,
        report.oldRowCount,
        report.newRowCount,
        report.counts.match,
        report.counts.mismatch,
        report.counts.oldOnly,
        report.counts.newOnly,
        report.counts.ambiguous,
      ],
    );
  }

  async completeBatch(executor: SqlExecutor, batchId: string, observationTypes: readonly string[]): Promise<void> {
    assertBatchId(batchId);
    if (observationTypes.length === 0 || new Set(observationTypes).size !== observationTypes.length) {
      throw new TypeError("Identity shadow verification batches require unique observation types.");
    }
    for (const observationType of observationTypes) assertObservationType(observationType);
    const placeholders = observationTypes.map(() => "?").join(", ");
    const [result] = await executor.execute<ResultSetHeader>(
      `UPDATE identity_shadow_verification_batch batch
       SET batch.status = 'COMPLETED', batch.observation_count = ?,
           batch.completed_at = CURRENT_TIMESTAMP(3)
       WHERE batch.id = ? AND batch.status = 'RUNNING'
         AND (SELECT COUNT(*) FROM identity_shadow_observation observation
              WHERE observation.verification_batch_id = batch.id) = ?
         AND (SELECT COUNT(*) FROM identity_shadow_observation observation
              WHERE observation.verification_batch_id = batch.id
                AND observation.observation_type IN (${placeholders})) = ?`,
      [observationTypes.length, batchId, observationTypes.length, ...observationTypes, observationTypes.length],
    );
    if (result.affectedRows !== 1) {
      throw new Error("Identity shadow verification batch is incomplete or no longer running.");
    }
  }
}

function assertObservation(observation: IdentityShadowObservation): void {
  if (observation.verificationBatchId !== undefined) assertBatchId(observation.verificationBatchId);
  assertObservationType(observation.observationType);
  if (!Number.isSafeInteger(observation.sourceHighWaterMark) || observation.sourceHighWaterMark < 0) {
    throw new TypeError("Identity shadow source high-water mark must be a non-negative safe integer.");
  }
  const { report } = observation;
  for (const [label, value] of [
    ["old row count", report.oldRowCount],
    ["new row count", report.newRowCount],
    ["match count", report.counts.match],
    ["mismatch count", report.counts.mismatch],
    ["old-only count", report.counts.oldOnly],
    ["new-only count", report.counts.newOnly],
    ["ambiguous count", report.counts.ambiguous],
  ] as const) {
    assertUnsignedInteger(value, label);
  }
}

function assertBatchId(batchId: string): void {
  if (!UUID_PATTERN.test(batchId)) throw new TypeError("Identity shadow verification batch IDs must be UUIDs.");
}

function assertObservationType(observationType: string): void {
  if (!OBSERVATION_TYPE_PATTERN.test(observationType)) {
    throw new TypeError("Identity shadow observation types must be 1-100 safe ASCII characters.");
  }
}

function assertUnsignedInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new TypeError(`Identity shadow ${label} must be an unsigned 32-bit integer.`);
  }
}
