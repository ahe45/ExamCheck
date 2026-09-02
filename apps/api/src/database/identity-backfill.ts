import { randomUUID } from "node:crypto";
import type { Connection, RowDataPacket } from "mysql2/promise";
import {
  CandidateIdentityRepository,
  IdentityProjectionConflictError,
} from "../candidates/candidate-identity.repository.js";
import { validateIdentityRanges } from "./identity-range-validation.js";
import {
  IdentityBackfillProjectionError,
  IdentityBackfillProjectionRepository,
} from "./identity-backfill-projection.repository.js";
import {
  DEFAULT_IDENTITY_BACKFILL_CHUNK_SIZE,
  IDENTITY_BACKFILL_ADVISORY_LOCK,
  type IdentityBackfillIssueStatus,
  type IdentityBackfillOptions,
  type IdentityBackfillReport,
  type SafeIssueDetails,
} from "./identity-backfill.types.js";

type BackfillConnection = Pick<Connection, "query" | "execute" | "beginTransaction" | "commit" | "rollback">;

interface IdRow extends RowDataPacket {
  id: number;
}

interface StringIdRow extends RowDataPacket {
  id: string;
}

interface CountRow extends RowDataPacket {
  count: number;
}

interface MaxIdRow extends RowDataPacket {
  maxId: number | null;
}

interface AdvisoryLockRow extends RowDataPacket {
  acquired: number | null;
}

interface AdvisoryUnlockRow extends RowDataPacket {
  released: number | null;
}

interface DatabaseNameRow extends RowDataPacket {
  databaseName: string | null;
}

interface TransitionStateRow extends RowDataPacket {
  writeMode: "LEGACY" | "DUAL" | "CANONICAL";
  readMode: "LEGACY" | "SHADOW" | "CANARY" | "CANONICAL";
  phase: string;
  lastBackfillRunId: string | null;
}

interface ExistingRunRow extends RowDataPacket {
  status: "RUNNING" | "SUCCEEDED" | "BLOCKED" | "FAILED";
  sourceHighWaterMark: number;
}

interface CheckpointRow extends RowDataPacket {
  lastSourceId: number;
}

interface IssueCountRow extends RowDataPacket {
  issueCode: string;
  status: "OPEN" | "ACCEPTED";
  count: number;
}

interface RangeProjectionRow extends RowDataPacket {
  policyId: number;
  sourceSettingId: number | null;
  pseudonymScope: "ADMISSION" | "SCHEDULE";
  admissionId: number;
  slotId: number;
  segmentId: number;
  rangeStart: number | null;
  rangeEnd: number | null;
  targetCount: number;
}

interface RangeSlotAccumulator {
  slotId: number;
  targetCount: number;
  segments: Array<{ segmentId: number; start: number; end: number }>;
}

interface RangeGroupAccumulator {
  policyId: number;
  sourceSettingId: number | null;
  scope: "ADMISSION" | "SCHEDULE";
  admissionId: number;
  targetCount: number;
  slots: Map<number, RangeSlotAccumulator>;
}

const NUMERIC_STAGES = [
  { entityType: "candidate_record", tableName: "candidate_record", idColumn: "id" },
  { entityType: "candidate_photo", tableName: "candidate_photo", idColumn: "candidate_record_id" },
  { entityType: "pseudonym_setting", tableName: "pseudonym_setting", idColumn: "id" },
  { entityType: "pseudonym_time_range", tableName: "pseudonym_time_range", idColumn: "id" },
  { entityType: "pseudonym_operation", tableName: "pseudonym_operation", idColumn: "id" },
  { entityType: "pseudonym_assignment", tableName: "pseudonym_assignment", idColumn: "id" },
  { entityType: "app_user", tableName: "app_user", idColumn: "id" },
] as const;

/**
 * Expand-only identity backfill. Every source row is projected in its own transaction,
 * checkpoints are monotonic, and unsafe source conflicts become PII-free issues rather
 * than guessed mappings. The caller must point this at an approved isolated restore.
 */
export class IdentityBackfillService {
  constructor(
    private readonly candidateRepository = new CandidateIdentityRepository(),
    private readonly projectionRepository = new IdentityBackfillProjectionRepository(),
  ) {}

  async run(connection: BackfillConnection, options: IdentityBackfillOptions): Promise<IdentityBackfillReport> {
    const databaseName = await currentDatabaseName(connection);
    assertIsolatedBackfillExecution(databaseName, options.confirmIsolatedCopy);
    const examName = options.examName.normalize("NFKC").trim();
    if (!examName) throw new TypeError("Identity backfill requires a non-blank exam name.");
    const chunkSize = resolveChunkSize(options.chunkSize);
    const runId = options.runId ?? randomUUID();
    assertUuid(runId);
    await acquireBackfillLock(connection);

    let sourceHighWaterMark = 0;
    let report: IdentityBackfillReport | undefined;
    let runFailure: unknown;
    try {
      sourceHighWaterMark = await this.startRun(connection, runId);
      const examCycleId = await this.inTransaction(connection, async () =>
        this.projectionRepository.ensureExamCycle(connection, examName),
      );

      await this.processNumericStage(connection, {
        runId,
        entityType: "candidate_record",
        tableName: "candidate_record",
        chunkSize,
        highWaterMark: sourceHighWaterMark,
        handler: async (sourceId) => {
          await this.candidateRepository.syncCandidateRecord(connection, sourceId, examName);
        },
      });
      await this.processNumericStage(connection, {
        runId,
        entityType: "candidate_photo",
        tableName: "candidate_photo",
        idColumn: "candidate_record_id",
        chunkSize,
        highWaterMark: sourceHighWaterMark,
        handler: (sourceId) => this.candidateRepository.syncCandidatePhoto(connection, sourceId),
      });
      await this.processNumericStage(connection, {
        runId,
        entityType: "pseudonym_setting",
        tableName: "pseudonym_setting",
        chunkSize,
        handler: (sourceId) => this.projectionRepository.syncSetting(connection, sourceId, examCycleId),
      });
      await this.processNumericStage(connection, {
        runId,
        entityType: "pseudonym_time_range",
        tableName: "pseudonym_time_range",
        chunkSize,
        handler: (sourceId) => this.projectionRepository.syncRange(connection, sourceId),
      });
      await this.processNumericStage(connection, {
        runId,
        entityType: "pseudonym_operation",
        tableName: "pseudonym_operation",
        chunkSize,
        handler: (sourceId) => this.projectionRepository.syncOperation(connection, sourceId, examCycleId),
      });
      await this.processNumericStage(connection, {
        runId,
        entityType: "pseudonym_assignment",
        tableName: "pseudonym_assignment",
        chunkSize,
        handler: async (sourceId) => {
          const result = await this.projectionRepository.syncAssignment(connection, sourceId, examCycleId);
          if (result.kind === "LEGACY_RESERVATION") {
            await this.recordIssue(connection, runId, {
              entityType: "pseudonym_assignment",
              sourceId,
              code: "LEGACY_ASSIGNMENT_RESERVED",
              status: "ACCEPTED",
            });
          }
        },
      });
      await this.processNumericStage(connection, {
        runId,
        entityType: "app_user",
        tableName: "app_user",
        chunkSize,
        handler: (sourceId) => this.projectionRepository.syncAccount(connection, sourceId, examCycleId),
      });

      await this.recordApprovedOrphanExaminees(connection, runId);
      await this.syncLegacyPrintSnapshots(connection, runId);
      await this.validateProjectionCounts(connection, runId, sourceHighWaterMark);
      await this.validateRanges(connection, runId, examCycleId);
      report = await this.finishRun(connection, runId, sourceHighWaterMark);
    } catch (error) {
      await this.failRun(connection, runId, sourceHighWaterMark, error);
      runFailure = error;
    }

    let releaseFailure: unknown;
    try {
      await releaseBackfillLock(connection);
    } catch (error) {
      releaseFailure = error;
    }

    if (runFailure && releaseFailure) {
      throw new AggregateError(
        [runFailure, releaseFailure],
        "Identity backfill failed and its advisory lock release failed.",
      );
    }
    if (runFailure) throw runFailure;
    if (releaseFailure) throw releaseFailure;
    if (!report) throw new Error("Identity backfill completed without a report.");
    return report;
  }

  private async startRun(connection: BackfillConnection, runId: string): Promise<number> {
    await connection.beginTransaction();
    try {
      const [states] = await connection.query<TransitionStateRow[]>(
        `SELECT write_mode AS writeMode, read_mode AS readMode, phase,
                last_backfill_run_id AS lastBackfillRunId
         FROM identity_transition_state WHERE id = 1 LIMIT 1 FOR UPDATE`,
      );
      const state = states[0];
      if (!state) throw new Error("Identity transition state is missing.");
      if (state.writeMode !== "LEGACY" || state.readMode !== "LEGACY") {
        throw new Error("Identity backfill requires LEGACY read and write modes.");
      }
      const [runs] = await connection.execute<ExistingRunRow[]>(
        `SELECT status, source_high_water_mark AS sourceHighWaterMark
         FROM identity_backfill_run WHERE id = ? LIMIT 1 FOR UPDATE`,
        [runId],
      );
      const existing = runs[0];
      if (existing && (existing.status === "SUCCEEDED" || existing.status === "BLOCKED")) {
        throw new Error(`Identity backfill run ${runId} is already finalized.`);
      }
      const sourceHighWaterMark = existing
        ? Number(existing.sourceHighWaterMark)
        : await maxSourceId(connection, "candidate_record");
      if (existing) {
        await connection.execute(
          `UPDATE identity_backfill_run
           SET status = 'RUNNING', completed_at = NULL, report_json = NULL
           WHERE id = ?`,
          [runId],
        );
      } else {
        await connection.execute(
          `INSERT INTO identity_backfill_run
            (id, status, source_high_water_mark)
           VALUES (?, 'RUNNING', ?)`,
          [runId, sourceHighWaterMark],
        );
      }
      await connection.execute(
        `UPDATE identity_transition_state
         SET phase = 'BACKFILLING', last_backfill_run_id = ?, version = version + 1
         WHERE id = 1`,
        [runId],
      );
      await connection.commit();
      return sourceHighWaterMark;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }

  private async processNumericStage(
    connection: BackfillConnection,
    input: {
      runId: string;
      entityType: (typeof NUMERIC_STAGES)[number]["entityType"];
      tableName: (typeof NUMERIC_STAGES)[number]["tableName"];
      idColumn?: (typeof NUMERIC_STAGES)[number]["idColumn"];
      chunkSize: number;
      highWaterMark?: number;
      handler: (sourceId: number) => Promise<void>;
    },
  ): Promise<void> {
    const idColumn = input.idColumn ?? "id";
    assertSourceIdentityColumn(input.tableName, idColumn);
    const maximum = input.highWaterMark ?? (await maxSourceId(connection, input.tableName, idColumn));
    let cursor = await this.loadCheckpoint(connection, input.runId, input.entityType);
    while (cursor < maximum) {
      const [rows] = await connection.query<IdRow[]>(
        `SELECT ${idColumn} AS id FROM ${input.tableName}
         WHERE ${idColumn} > ? AND ${idColumn} <= ? ORDER BY ${idColumn} LIMIT ?`,
        [cursor, maximum, input.chunkSize],
      );
      if (!rows.length) break;
      for (const row of rows) {
        const sourceId = Number(row.id);
        await connection.beginTransaction();
        try {
          await input.handler(sourceId);
          await connection.execute(
            `UPDATE identity_migration_issue SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP(3)
             WHERE run_id = ? AND entity_type = ? AND source_id = ? AND status = 'OPEN'`,
            [input.runId, input.entityType, sourceId],
          );
          await this.advanceCheckpoint(connection, input.runId, input.entityType, sourceId);
          await connection.commit();
        } catch (error) {
          await connection.rollback();
          const issue = normalizeProjectionIssue(error, input.entityType, sourceId);
          if (!issue) throw error;
          await connection.beginTransaction();
          try {
            await this.recordIssue(connection, input.runId, issue);
            await this.advanceCheckpoint(connection, input.runId, input.entityType, sourceId);
            await connection.commit();
          } catch (recordError) {
            await connection.rollback();
            throw recordError;
          }
        }
        cursor = sourceId;
      }
    }
  }

  private async loadCheckpoint(connection: BackfillConnection, runId: string, entityType: string): Promise<number> {
    const [rows] = await connection.execute<CheckpointRow[]>(
      `SELECT last_source_id AS lastSourceId
       FROM identity_backfill_checkpoint WHERE run_id = ? AND entity_type = ? LIMIT 1`,
      [runId, entityType],
    );
    return Number(rows[0]?.lastSourceId ?? 0);
  }

  private async advanceCheckpoint(
    connection: BackfillConnection,
    runId: string,
    entityType: string,
    sourceId: number,
  ): Promise<void> {
    await connection.execute(
      `INSERT INTO identity_backfill_checkpoint
        (run_id, entity_type, last_source_id, processed_count)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         last_source_id = GREATEST(last_source_id, VALUES(last_source_id)),
         processed_count = processed_count + 1`,
      [runId, entityType, sourceId],
    );
  }

  private async recordApprovedOrphanExaminees(connection: BackfillConnection, runId: string): Promise<void> {
    const [rows] = await connection.query<IdRow[]>(
      `SELECT examinee.id
       FROM examinee
       LEFT JOIN candidate candidate_identity ON candidate_identity.source_examinee_id = examinee.id
       WHERE candidate_identity.id IS NULL
       ORDER BY examinee.id`,
    );
    await connection.beginTransaction();
    try {
      for (const row of rows) {
        await this.recordIssue(connection, runId, {
          entityType: "examinee",
          sourceId: Number(row.id),
          code: "ORPHAN_EXAMINEE_PRESERVED",
          status: "ACCEPTED",
        });
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }

  private async syncLegacyPrintSnapshots(connection: BackfillConnection, runId: string): Promise<void> {
    const [rows] = await connection.query<StringIdRow[]>(`SELECT id FROM print_job ORDER BY created_at, id`);
    await connection.beginTransaction();
    try {
      for (const row of rows) await this.projectionRepository.syncPrintSnapshot(connection, row.id);
      const [counts] = await connection.query<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM print_job job
         LEFT JOIN print_projection_snapshot snapshot ON snapshot.print_job_id = job.id
         WHERE snapshot.print_job_id IS NULL`,
      );
      const missing = Number(counts[0]?.count ?? 0);
      if (missing > 0) {
        await this.recordIssue(connection, runId, {
          entityType: "print_job",
          sourceId: null,
          code: "PRINT_SNAPSHOT_MISSING",
          status: "OPEN",
          details: { missingCount: missing },
        });
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }

  private async validateProjectionCounts(
    connection: BackfillConnection,
    runId: string,
    sourceHighWaterMark: number,
  ): Promise<void> {
    const sourceCandidateCount = await scalarCount(
      connection,
      `SELECT COUNT(*) AS count FROM candidate_record WHERE id <= ?`,
      [sourceHighWaterMark],
    );
    const targetRegistrationCount = await scalarCount(
      connection,
      `SELECT COUNT(*) AS count FROM candidate_registration
       WHERE source_candidate_record_id IS NOT NULL AND source_candidate_record_id <= ?`,
      [sourceHighWaterMark],
    );
    await connection.beginTransaction();
    try {
      await connection.execute(
        `UPDATE identity_migration_issue SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP(3)
         WHERE run_id = ? AND entity_type = 'candidate_projection'
           AND issue_code = 'CANDIDATE_COUNT_MISMATCH' AND status = 'OPEN'`,
        [runId],
      );
      if (sourceCandidateCount !== targetRegistrationCount) {
        await this.recordIssue(connection, runId, {
          entityType: "candidate_projection",
          sourceId: null,
          code: "CANDIDATE_COUNT_MISMATCH",
          status: "OPEN",
          details: { sourceCount: sourceCandidateCount, targetCount: targetRegistrationCount },
        });
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }

  private async validateRanges(connection: BackfillConnection, runId: string, examCycleId: number): Promise<void> {
    const [rows] = await connection.execute<RangeProjectionRow[]>(
      `SELECT policy.id AS policyId, policy.source_setting_id AS sourceSettingId,
              uniqueness_policy.pseudonym_scope AS pseudonymScope,
              admission.id AS admissionId, slot.id AS slotId, segment.id AS segmentId,
              pseudonym_range.range_start_value AS rangeStart,
              pseudonym_range.range_end_value AS rangeEnd,
              (
                SELECT COUNT(*)
                FROM candidate_registration registration
                INNER JOIN schedule_segment registration_segment
                  ON registration_segment.id = registration.schedule_segment_id
                WHERE registration_segment.operation_slot_id = slot.id
                  AND registration.status = 'ACTIVE'
              ) AS targetCount
       FROM pseudonym_policy policy
       INNER JOIN number_uniqueness_policy uniqueness_policy
         ON uniqueness_policy.exam_cycle_id = policy.exam_cycle_id
       INNER JOIN admission
         ON admission.exam_cycle_id = policy.exam_cycle_id
        AND (
          policy.admission_id = admission.id
          OR (
            policy.scope_kind = 'DEFAULT'
            AND NOT EXISTS (
              SELECT 1
              FROM pseudonym_policy admission_override
              WHERE admission_override.exam_cycle_id = policy.exam_cycle_id
                AND admission_override.scope_kind = 'ADMISSION'
                AND admission_override.admission_id = admission.id
            )
          )
        )
       INNER JOIN operation_slot slot ON slot.admission_id = admission.id AND slot.status = 'ACTIVE'
       INNER JOIN schedule_segment segment ON segment.operation_slot_id = slot.id AND segment.status = 'ACTIVE'
       LEFT JOIN pseudonym_range
         ON pseudonym_range.pseudonym_policy_id = policy.id
        AND pseudonym_range.schedule_segment_id = segment.id
       WHERE policy.exam_cycle_id = ?
         AND policy.assignment_method IN ('DRAW', 'SEQUENTIAL')
       ORDER BY policy.id, admission.id, slot.id, segment.id`,
      [examCycleId],
    );
    const groups = buildRangeGroups(rows);
    await connection.beginTransaction();
    try {
      await connection.execute(
        `UPDATE identity_migration_issue SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP(3)
         WHERE run_id = ? AND entity_type = 'pseudonym_range_validation' AND status = 'OPEN'`,
        [runId],
      );
      for (const group of groups.values()) {
        const slots = [...group.slots.values()];
        const result =
          group.scope === "ADMISSION"
            ? validateIdentityRanges({
                policyScope: "ADMISSION",
                targetCount: group.targetCount,
                slots: slots.map(({ slotId, segments }) => ({ slotId, segments })),
              })
            : validateIdentityRanges({
                policyScope: "SCHEDULE",
                targetCount: group.targetCount,
                slots,
              });
        for (const code of result.blockingIssueCodes) {
          await this.recordIssue(connection, runId, {
            entityType: "pseudonym_range_validation",
            sourceId: group.sourceSettingId ?? group.policyId,
            code,
            status: "OPEN",
            details: {
              policyId: group.policyId,
              admissionId: group.admissionId,
              targetCount: group.targetCount,
              rawCapacitySum: result.rawCapacitySum,
              unionCapacity: result.unionCapacity,
              overlapPairCount: result.overlapPairCount,
              deficit: result.deficit,
            },
          });
        }
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }

  private async finishRun(
    connection: BackfillConnection,
    runId: string,
    sourceHighWaterMark: number,
  ): Promise<IdentityBackfillReport> {
    const report = await this.buildReport(connection, runId, sourceHighWaterMark);
    await connection.beginTransaction();
    try {
      await connection.execute(
        `UPDATE identity_backfill_run
         SET status = ?, exact_count = ?, issue_count = ?, report_json = ?,
             completed_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND status = 'RUNNING'`,
        [
          report.status,
          report.targetRegistrationCount,
          report.blockingIssueCount + report.acceptedIssueCount,
          JSON.stringify(report),
          runId,
        ],
      );
      await connection.execute(
        `UPDATE identity_transition_state
         SET phase = ?, write_mode = 'LEGACY', read_mode = 'LEGACY', version = version + 1
         WHERE id = 1 AND last_backfill_run_id = ?`,
        [report.status === "SUCCEEDED" ? "BACKFILLED" : "BLOCKED", runId],
      );
      await connection.commit();
      return report;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }

  private async buildReport(
    connection: BackfillConnection,
    runId: string,
    sourceHighWaterMark: number,
  ): Promise<IdentityBackfillReport> {
    const sourceCandidateCount = await scalarCount(
      connection,
      `SELECT COUNT(*) AS count FROM candidate_record WHERE id <= ?`,
      [sourceHighWaterMark],
    );
    const targetRegistrationCount = await scalarCount(
      connection,
      `SELECT COUNT(*) AS count FROM candidate_registration
       WHERE source_candidate_record_id IS NOT NULL AND source_candidate_record_id <= ?`,
      [sourceHighWaterMark],
    );
    const targetCandidateCount = await scalarCount(
      connection,
      `SELECT COUNT(*) AS count FROM candidate WHERE status <> 'ARCHIVED'`,
    );
    const exactAssignmentCount = await scalarCount(
      connection,
      `SELECT COUNT(*) AS count FROM candidate_pseudonym_assignment`,
    );
    const legacyReservationCount = await scalarCount(
      connection,
      `SELECT COUNT(*) AS count FROM legacy_pseudonym_reservation`,
    );
    const [issues] = await connection.execute<IssueCountRow[]>(
      `SELECT issue_code AS issueCode, status, COUNT(*) AS count
       FROM identity_migration_issue
       WHERE run_id = ? AND status IN ('OPEN', 'ACCEPTED')
       GROUP BY issue_code, status
       ORDER BY status, issue_code`,
      [runId],
    );
    const blockingIssueCount = issues
      .filter((issue) => issue.status === "OPEN")
      .reduce((sum, issue) => sum + Number(issue.count), 0);
    const acceptedIssueCount = issues
      .filter((issue) => issue.status === "ACCEPTED")
      .reduce((sum, issue) => sum + Number(issue.count), 0);
    return {
      runId,
      status: blockingIssueCount === 0 ? "SUCCEEDED" : "BLOCKED",
      sourceHighWaterMark,
      sourceCandidateCount,
      targetRegistrationCount,
      targetCandidateCount,
      exactAssignmentCount,
      legacyReservationCount,
      acceptedIssueCount,
      blockingIssueCount,
      issueSummary: issues.map((issue) => ({
        code: issue.issueCode,
        status: issue.status,
        count: Number(issue.count),
      })),
    };
  }

  private async failRun(
    connection: BackfillConnection,
    runId: string,
    sourceHighWaterMark: number,
    error: unknown,
  ): Promise<void> {
    try {
      await connection.rollback();
    } catch {
      // A failed operation may already have rolled back. Continue with the safety record.
    }
    try {
      await connection.beginTransaction();
      const report = {
        runId,
        status: "FAILED",
        sourceHighWaterMark,
        failureCode: classifyFailure(error),
      } as const;
      await connection.execute(
        `UPDATE identity_backfill_run
         SET status = 'FAILED', report_json = ?, completed_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND status = 'RUNNING'`,
        [JSON.stringify(report), runId],
      );
      await connection.execute(
        `UPDATE identity_transition_state
         SET phase = 'BLOCKED', write_mode = 'LEGACY', read_mode = 'LEGACY', version = version + 1
         WHERE id = 1 AND last_backfill_run_id = ?`,
        [runId],
      );
      await connection.commit();
    } catch {
      try {
        await connection.rollback();
      } catch {
        // The original failure remains authoritative.
      }
    }
  }

  private async recordIssue(
    connection: BackfillConnection,
    runId: string,
    issue: {
      entityType: string;
      sourceId: number | null;
      code: string;
      status: Exclude<IdentityBackfillIssueStatus, "RESOLVED">;
      details?: SafeIssueDetails;
    },
  ): Promise<void> {
    assertSafeIdentifier(issue.entityType, "entity type");
    assertSafeIdentifier(issue.code, "issue code");
    if (issue.sourceId !== null && (!Number.isSafeInteger(issue.sourceId) || issue.sourceId <= 0)) {
      throw new TypeError("Identity backfill issue source IDs must be positive safe integers or null.");
    }
    const details = issue.details ? JSON.stringify(assertSafeIssueDetails(issue.details)) : null;
    if (issue.sourceId === null) {
      const [rows] = await connection.execute<IdRow[]>(
        `SELECT id FROM identity_migration_issue
         WHERE run_id = ? AND entity_type = ? AND source_id IS NULL AND issue_code = ?
         ORDER BY id LIMIT 1 FOR UPDATE`,
        [runId, issue.entityType, issue.code],
      );
      const existing = rows[0];
      if (existing) {
        await connection.execute(
          `UPDATE identity_migration_issue
           SET details_json = ?, status = ?, resolved_at = NULL
           WHERE id = ?`,
          [details, issue.status, existing.id],
        );
        return;
      }
    }
    await connection.execute(
      `INSERT INTO identity_migration_issue
        (run_id, entity_type, source_id, issue_code, details_json, status)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE details_json = VALUES(details_json), status = VALUES(status),
         resolved_at = IF(VALUES(status) = 'RESOLVED', CURRENT_TIMESTAMP(3), NULL)`,
      [runId, issue.entityType, issue.sourceId, issue.code, details, issue.status],
    );
  }

  private async inTransaction<T>(connection: BackfillConnection, task: () => Promise<T>): Promise<T> {
    await connection.beginTransaction();
    try {
      const result = await task();
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }
}

export function assertIsolatedBackfillExecution(databaseName: string, confirmed: boolean): void {
  if (!confirmed) {
    throw new Error("Identity backfill is blocked until isolated-copy execution is explicitly confirmed.");
  }
  if (!/(?:^|[_-])(it|test|shadow|sandbox|staging|refactor)(?:[_-]|$)/i.test(databaseName)) {
    throw new Error("Identity backfill only accepts an explicitly named isolated database copy.");
  }
}

async function currentDatabaseName(connection: BackfillConnection): Promise<string> {
  const [rows] = await connection.query<DatabaseNameRow[]>("SELECT DATABASE() AS databaseName");
  const databaseName = rows[0]?.databaseName;
  if (!databaseName) throw new Error("Identity backfill requires an explicitly selected database.");
  return databaseName;
}

function buildRangeGroups(rows: readonly RangeProjectionRow[]): Map<string, RangeGroupAccumulator> {
  const groups = new Map<string, RangeGroupAccumulator>();
  for (const row of rows) {
    const key = `${row.policyId}:${row.admissionId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        policyId: Number(row.policyId),
        sourceSettingId: row.sourceSettingId === null ? null : Number(row.sourceSettingId),
        scope: row.pseudonymScope,
        admissionId: Number(row.admissionId),
        targetCount: 0,
        slots: new Map(),
      };
      groups.set(key, group);
    }
    let slot = group.slots.get(Number(row.slotId));
    if (!slot) {
      slot = { slotId: Number(row.slotId), targetCount: Number(row.targetCount), segments: [] };
      group.slots.set(slot.slotId, slot);
      group.targetCount += slot.targetCount;
    }
    if (row.rangeStart !== null && row.rangeEnd !== null) {
      slot.segments.push({
        segmentId: Number(row.segmentId),
        start: Number(row.rangeStart),
        end: Number(row.rangeEnd),
      });
    }
  }
  return groups;
}

function normalizeProjectionIssue(
  error: unknown,
  fallbackEntityType: string,
  fallbackSourceId: number,
): {
  entityType: string;
  sourceId: number;
  code: string;
  status: "OPEN";
  details?: SafeIssueDetails;
} | null {
  if (error instanceof IdentityProjectionConflictError) {
    return {
      entityType: error.entityType,
      sourceId: error.sourceId,
      code: error.code,
      status: "OPEN",
    };
  }
  if (error instanceof IdentityBackfillProjectionError) {
    return {
      entityType: error.entityType,
      sourceId: error.sourceId,
      code: error.code,
      status: "OPEN",
      ...(Object.keys(error.details).length ? { details: error.details } : {}),
    };
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    return {
      entityType: fallbackEntityType,
      sourceId: fallbackSourceId,
      code: "SOURCE_VALUE_INVALID",
      status: "OPEN",
    };
  }
  return null;
}

async function maxSourceId(connection: BackfillConnection, tableName: string, idColumn = "id"): Promise<number> {
  assertSourceIdentityColumn(tableName, idColumn);
  const [rows] = await connection.query<MaxIdRow[]>(`SELECT MAX(${idColumn}) AS maxId FROM ${tableName}`);
  return Number(rows[0]?.maxId ?? 0);
}

async function scalarCount(
  connection: BackfillConnection,
  sql: string,
  parameters: readonly (boolean | number | string | null)[] = [],
): Promise<number> {
  const [rows] = await connection.execute<CountRow[]>(sql, [...parameters]);
  return Number(rows[0]?.count ?? 0);
}

async function acquireBackfillLock(connection: BackfillConnection): Promise<void> {
  const [rows] = await connection.execute<AdvisoryLockRow[]>(`SELECT GET_LOCK(?, 0) AS acquired`, [
    IDENTITY_BACKFILL_ADVISORY_LOCK,
  ]);
  if (Number(rows[0]?.acquired) !== 1) {
    throw new Error("Another identity backfill is already running.");
  }
}

async function releaseBackfillLock(connection: BackfillConnection): Promise<void> {
  const [rows] = await connection.execute<AdvisoryUnlockRow[]>(`SELECT RELEASE_LOCK(?) AS released`, [
    IDENTITY_BACKFILL_ADVISORY_LOCK,
  ]);
  if (Number(rows[0]?.released) !== 1) throw new Error("Identity backfill advisory lock was not released.");
}

function resolveChunkSize(value: number | undefined): number {
  const size = value ?? DEFAULT_IDENTITY_BACKFILL_CHUNK_SIZE;
  if (!Number.isInteger(size) || size < 1 || size > 1_000) {
    throw new TypeError("Identity backfill chunk size must be an integer from 1 to 1000.");
  }
  return size;
}

function assertUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new TypeError("Identity backfill run ID must be a UUID.");
  }
}

function assertSafeIdentifier(value: string, label: string): void {
  if (!/^[A-Z0-9_]{1,100}$/i.test(value)) throw new TypeError(`Unsafe identity backfill ${label}.`);
}

function assertSafeIssueDetails(details: SafeIssueDetails): SafeIssueDetails {
  const safe: Record<string, number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,99}$/.test(key)) throw new TypeError("Unsafe identity issue detail key.");
    if (value !== null && typeof value !== "boolean" && !(typeof value === "number" && Number.isSafeInteger(value))) {
      throw new TypeError("Identity issue details may contain only safe integers, booleans, and null.");
    }
    safe[key] = value;
  }
  return safe;
}

function assertSourceIdentityColumn(tableName: string, idColumn: string): void {
  if (!NUMERIC_STAGES.some((stage) => stage.tableName === tableName && stage.idColumn === idColumn)) {
    throw new TypeError("Identity backfill source table or identity column is not allowed.");
  }
}

function classifyFailure(error: unknown): string {
  if (error instanceof IdentityProjectionConflictError) return error.code;
  if (error instanceof IdentityBackfillProjectionError) return error.code;
  if (error instanceof TypeError || error instanceof RangeError) return "VALIDATION_FAILURE";
  return "UNEXPECTED_FAILURE";
}
