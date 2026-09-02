import type { Connection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type {
  CreateTransitionRequestInput,
  IdentityTransitionApprovalType,
  IdentityTransitionEvidenceType,
  IdentityTransitionTargetStage,
  RecordTransitionEvidenceInput,
} from "./identity-transition-gate.service.js";
import type { IdentityReadMode, IdentityTransitionPhase, IdentityWriteMode } from "./identity-transition-state.js";
import type { IdentityShadowObservationType } from "./identity-shadow-snapshot.repository.js";

export type IdentityTransitionGateConnection = Pick<
  Connection,
  "query" | "execute" | "beginTransaction" | "commit" | "rollback"
>;

export interface IdentityTransitionStateRow extends RowDataPacket {
  writeMode: IdentityWriteMode;
  readMode: IdentityReadMode;
  phase: IdentityTransitionPhase;
  version: number;
  lastBackfillRunId: string | null;
}

export interface IdentityTransitionRequestRow extends RowDataPacket {
  id: string;
  targetStage: IdentityTransitionTargetStage;
  status: "PENDING" | "APPLIED" | "CANCELLED";
  expectedStateVersion: number;
  reasonCode: string;
  minimumComparedEntityCount: number | null;
  minimumObservationMinutes: number | null;
  maximumRollbackMinutes: number;
  requestedBy: number;
}

export interface IdentityTransitionEvidenceRow extends RowDataPacket {
  evidenceId: string;
  evidenceType: IdentityTransitionEvidenceType;
  elapsedMinutes: number | null;
}

export interface IdentityTransitionApprovalRow extends RowDataPacket {
  approvalType: IdentityTransitionApprovalType;
  approvedBy: number;
}

export interface IdentityBackfillGateRow extends RowDataPacket {
  status: "RUNNING" | "SUCCEEDED" | "BLOCKED" | "FAILED";
  completedAt: Date | null;
}

export interface IdentityObservationAggregateRow extends RowDataPacket {
  observationType: IdentityShadowObservationType;
  observationCount: number | string;
  comparedEntityCount: number | string;
  mismatchCount: number | string;
  oldOnlyCount: number | string;
  newOnlyCount: number | string;
  ambiguousCount: number | string;
  firstObservedAt: Date | string | null;
  lastObservedAt: Date | string | null;
}

export interface IdentityObservationWatermarkRow extends RowDataPacket {
  observationType: IdentityShadowObservationType;
  sourceHighWaterMark: number | string;
}

export const identityRelationshipInvariantCodes = [
  "ACTIVE_CYCLE_NUMBER_POLICY",
  "CANDIDATE_REGISTRATION_CYCLE",
  "CANDIDATE_REGISTRATION_SLOT",
  "PSEUDONYM_POLICY_ADMISSION_CYCLE",
  "PSEUDONYM_RANGE_POLICY_SEGMENT",
  "ASSIGNMENT_REGISTRATION_OPERATION",
  "CANDIDATE_NUMBER_CLAIM_SCOPE",
  "PSEUDONYM_NUMBER_CLAIM_SCOPE",
  "PRINT_REFERENCE_GRAPH",
] as const;

export type IdentityRelationshipInvariantCode = (typeof identityRelationshipInvariantCodes)[number];

export interface IdentityRelationshipInvariantAggregateRow extends RowDataPacket {
  invariantCode: IdentityRelationshipInvariantCode;
  violationCount: number | string;
}

export interface IdentityRangeAdmissionRow extends RowDataPacket {
  admissionId: number | string;
  policyScope: "ADMISSION" | "SCHEDULE" | null;
  targetCount: number | string;
}

export interface IdentityRangeSlotRow extends RowDataPacket {
  admissionId: number | string;
  slotId: number | string;
  targetCount: number | string;
}

export interface IdentityRangeSegmentRow extends RowDataPacket {
  admissionId: number | string;
  slotId: number | string;
  segmentId: number | string;
  rangeStart: number | string;
  rangeEnd: number | string;
}

export interface IdentityRangeValidationSnapshot {
  admissions: IdentityRangeAdmissionRow[];
  slots: IdentityRangeSlotRow[];
  segments: IdentityRangeSegmentRow[];
}

export interface IdentityTransitionTargetState {
  writeMode: IdentityWriteMode;
  readMode: IdentityReadMode;
  phase: IdentityTransitionPhase;
}

interface CountRow extends RowDataPacket {
  count: number | string;
}

interface EnteredAtRow extends RowDataPacket {
  enteredAt: Date | string;
}

interface ObservationBatchRow extends RowDataPacket {
  batchId: string;
}

interface SourceMutationHighWaterMarkRow extends RowDataPacket {
  sourceHighWaterMark: number | string;
}

const EXPECTED_POLICY_SCOPE_KEY_SQL = identityDigestSql("pseudonym-policy-scope", [
  "policy.scope_kind",
  "CASE WHEN policy.scope_kind = 'DEFAULT' THEN CAST(policy.exam_cycle_id AS CHAR) " +
    "ELSE CAST(policy.admission_id AS CHAR) END",
]);
const EXPECTED_CANDIDATE_SCOPE_KEY_SQL = identityDigestSql("candidate-number-scope", [
  "claim.scope_kind",
  "CASE WHEN claim.scope_kind = 'SYSTEM' THEN CAST(claim.exam_cycle_id AS CHAR) " +
    "ELSE CAST(claim.operation_slot_id AS CHAR) END",
]);
const EXPECTED_CANDIDATE_OWNER_KEY_SQL = identityDigestSql("candidate-number-owner", [
  "CASE WHEN claim.scope_kind = 'SYSTEM' THEN 'CANDIDATE' ELSE 'REGISTRATION' END",
  "CASE WHEN claim.scope_kind = 'SYSTEM' THEN CAST(claim.candidate_id AS CHAR) " +
    "ELSE CAST(claim.registration_id AS CHAR) END",
]);
const EXPECTED_PSEUDONYM_SCOPE_KEY_SQL = identityDigestSql("pseudonym-number-scope", [
  "claim.scope_kind",
  "CASE WHEN claim.scope_kind = 'ADMISSION' THEN CAST(claim.admission_id AS CHAR) " +
    "ELSE CAST(claim.operation_slot_id AS CHAR) END",
]);

export class IdentityTransitionGateRepository {
  async insertEvidence(
    connection: IdentityTransitionGateConnection,
    evidenceId: string,
    input: RecordTransitionEvidenceInput,
  ): Promise<void> {
    await connection.execute(
      `INSERT INTO identity_transition_gate_evidence
        (id, evidence_type, result, reference_code, elapsed_minutes, observed_at,
         valid_until, recorded_by, verified_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        evidenceId,
        input.evidenceType,
        input.result,
        input.referenceCode,
        input.elapsedMinutes ?? null,
        input.observedAt,
        input.validUntil,
        input.recordedBy,
        input.verifiedBy,
      ],
    );
  }

  async loadState(
    connection: IdentityTransitionGateConnection,
    lock: boolean,
  ): Promise<IdentityTransitionStateRow | undefined> {
    const [rows] = await connection.query<IdentityTransitionStateRow[]>(
      `SELECT write_mode AS writeMode, read_mode AS readMode, phase, version,
              last_backfill_run_id AS lastBackfillRunId
       FROM identity_transition_state WHERE id = 1${lock ? " FOR UPDATE" : ""}`,
    );
    return rows[0];
  }

  async insertRequest(
    connection: IdentityTransitionGateConnection,
    requestId: string,
    input: CreateTransitionRequestInput,
  ): Promise<void> {
    await connection.execute(
      `INSERT INTO identity_transition_request
        (id, target_stage, expected_state_version, reason_code,
         minimum_compared_entity_count, minimum_observation_minutes,
         maximum_rollback_minutes, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        requestId,
        input.targetStage,
        input.expectedStateVersion,
        input.reasonCode,
        input.minimumComparedEntityCount ?? null,
        input.minimumObservationMinutes ?? null,
        input.maximumRollbackMinutes,
        input.requestedBy,
      ],
    );
  }

  async loadRequest(
    connection: IdentityTransitionGateConnection,
    requestId: string,
    lock: boolean,
  ): Promise<IdentityTransitionRequestRow | undefined> {
    const [rows] = await connection.execute<IdentityTransitionRequestRow[]>(
      `SELECT id, target_stage AS targetStage, status,
              expected_state_version AS expectedStateVersion, reason_code AS reasonCode,
              minimum_compared_entity_count AS minimumComparedEntityCount,
              minimum_observation_minutes AS minimumObservationMinutes,
              maximum_rollback_minutes AS maximumRollbackMinutes,
              requested_by AS requestedBy
       FROM identity_transition_request WHERE id = ?${lock ? " FOR UPDATE" : ""}`,
      [requestId],
    );
    return rows[0];
  }

  async evidenceExists(connection: IdentityTransitionGateConnection, evidenceId: string): Promise<boolean> {
    const [rows] = await connection.execute<CountRow[]>(
      "SELECT COUNT(*) AS count FROM identity_transition_gate_evidence WHERE id = ?",
      [evidenceId],
    );
    return Number(rows[0]?.count ?? 0) === 1;
  }

  async linkRequestEvidence(
    connection: IdentityTransitionGateConnection,
    requestId: string,
    evidenceId: string,
    actorUserId: number,
  ): Promise<void> {
    await connection.execute(
      `INSERT INTO identity_transition_request_evidence (request_id, evidence_id, linked_by)
       VALUES (?, ?, ?)`,
      [requestId, evidenceId, actorUserId],
    );
  }

  async insertApproval(
    connection: IdentityTransitionGateConnection,
    requestId: string,
    approvalType: IdentityTransitionApprovalType,
    approvedBy: number,
  ): Promise<void> {
    await connection.execute(
      `INSERT INTO identity_transition_request_approval (request_id, approval_type, approved_by)
       VALUES (?, ?, ?)`,
      [requestId, approvalType, approvedBy],
    );
  }

  async loadApprovals(
    connection: IdentityTransitionGateConnection,
    requestId: string,
  ): Promise<IdentityTransitionApprovalRow[]> {
    const [rows] = await connection.execute<IdentityTransitionApprovalRow[]>(
      `SELECT approval_type AS approvalType, approved_by AS approvedBy
       FROM identity_transition_request_approval WHERE request_id = ?`,
      [requestId],
    );
    return rows;
  }

  async loadRequestEvidence(
    connection: IdentityTransitionGateConnection,
    requestId: string,
  ): Promise<IdentityTransitionEvidenceRow[]> {
    const [rows] = await connection.execute<IdentityTransitionEvidenceRow[]>(
      `SELECT e.id AS evidenceId, e.evidence_type AS evidenceType, e.elapsed_minutes AS elapsedMinutes
       FROM identity_transition_request_evidence re
       INNER JOIN identity_transition_gate_evidence e ON e.id = re.evidence_id
       WHERE re.request_id = ? AND e.result = 'PASSED'
         AND e.observed_at <= CURRENT_TIMESTAMP(3)
         AND e.valid_until >= CURRENT_TIMESTAMP(3)
       ORDER BY e.observed_at DESC, e.id`,
      [requestId],
    );
    return rows;
  }

  async loadExplicitEvidence(
    connection: IdentityTransitionGateConnection,
    evidenceIds: readonly string[],
  ): Promise<IdentityTransitionEvidenceRow[]> {
    if (evidenceIds.length === 0) return [];
    const placeholders = evidenceIds.map(() => "?").join(", ");
    const [rows] = await connection.execute<IdentityTransitionEvidenceRow[]>(
      `SELECT id AS evidenceId, evidence_type AS evidenceType, elapsed_minutes AS elapsedMinutes
       FROM identity_transition_gate_evidence
       WHERE id IN (${placeholders}) AND result = 'PASSED'
         AND observed_at <= CURRENT_TIMESTAMP(3)
         AND valid_until >= CURRENT_TIMESTAMP(3)
       ORDER BY observed_at DESC, id`,
      [...evidenceIds],
    );
    return rows;
  }

  async loadBackfillRun(
    connection: IdentityTransitionGateConnection,
    runId: string,
  ): Promise<IdentityBackfillGateRow | undefined> {
    const [rows] = await connection.execute<IdentityBackfillGateRow[]>(
      `SELECT status, completed_at AS completedAt
       FROM identity_backfill_run WHERE id = ?`,
      [runId],
    );
    return rows[0];
  }

  async countOpenIssues(connection: IdentityTransitionGateConnection, runId: string): Promise<number> {
    const [rows] = await connection.execute<CountRow[]>(
      `SELECT COUNT(*) AS count FROM identity_migration_issue
       WHERE run_id = ? AND status = 'OPEN'`,
      [runId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async loadLatestPhaseEntry(
    connection: IdentityTransitionGateConnection,
    phase: IdentityTransitionPhase,
  ): Promise<Date | string | undefined> {
    const [rows] = await connection.execute<EnteredAtRow[]>(
      `SELECT created_at AS enteredAt FROM identity_transition_state_history
       WHERE to_phase = ? ORDER BY id DESC LIMIT 1`,
      [phase],
    );
    return rows[0]?.enteredAt;
  }

  async loadObservationAggregates(
    connection: IdentityTransitionGateConnection,
    enteredAt: Date | string,
    observationTypes: readonly IdentityShadowObservationType[],
  ): Promise<IdentityObservationAggregateRow[]> {
    if (observationTypes.length === 0) return [];
    const placeholders = observationTypes.map(() => "?").join(", ");
    const [rows] = await connection.execute<IdentityObservationAggregateRow[]>(
      `SELECT observation_type AS observationType,
              COUNT(*) AS observationCount,
              COALESCE(SUM(match_count + mismatch_count + old_only_count
                          + new_only_count + ambiguous_count), 0) AS comparedEntityCount,
              COALESCE(SUM(mismatch_count), 0) AS mismatchCount,
              COALESCE(SUM(old_only_count), 0) AS oldOnlyCount,
              COALESCE(SUM(new_only_count), 0) AS newOnlyCount,
              COALESCE(SUM(ambiguous_count), 0) AS ambiguousCount,
              MIN(observed_at) AS firstObservedAt,
              MAX(observed_at) AS lastObservedAt
       FROM identity_shadow_observation observation
       INNER JOIN identity_shadow_verification_batch batch
         ON batch.id = observation.verification_batch_id AND batch.status = 'COMPLETED'
       WHERE batch.started_at >= ? AND batch.completed_at <= CURRENT_TIMESTAMP(3)
         AND observation.observed_at >= ? AND observation.observed_at <= CURRENT_TIMESTAMP(3)
         AND observation.observation_type IN (${placeholders})
       GROUP BY observation.observation_type`,
      [enteredAt, enteredAt, ...observationTypes],
    );
    return rows;
  }

  async loadLatestCompletedObservationWatermarks(
    connection: IdentityTransitionGateConnection,
    enteredAt: Date | string,
    observationTypes: readonly IdentityShadowObservationType[],
  ): Promise<IdentityObservationWatermarkRow[]> {
    if (observationTypes.length === 0) return [];
    const placeholders = observationTypes.map(() => "?").join(", ");
    const [batches] = await connection.execute<ObservationBatchRow[]>(
      `SELECT batch.id AS batchId
       FROM identity_shadow_verification_batch batch
       WHERE batch.status = 'COMPLETED'
         AND batch.started_at >= ? AND batch.completed_at <= CURRENT_TIMESTAMP(3)
         AND batch.observation_count = ?
         AND (SELECT COUNT(*) FROM identity_shadow_observation observation
              WHERE observation.verification_batch_id = batch.id
                AND observation.observation_type IN (${placeholders})) = ?
       ORDER BY batch.completed_at DESC, batch.id DESC
       LIMIT 1`,
      [enteredAt, observationTypes.length, ...observationTypes, observationTypes.length],
    );
    const batchId = batches[0]?.batchId;
    if (!batchId) return [];
    const [rows] = await connection.execute<IdentityObservationWatermarkRow[]>(
      `SELECT observation_type AS observationType,
              source_high_water_mark AS sourceHighWaterMark
       FROM identity_shadow_observation
       WHERE verification_batch_id = ? AND observation_type IN (${placeholders})
       ORDER BY observation_type`,
      [batchId, ...observationTypes],
    );
    return rows;
  }

  async loadCurrentSourceMutationHighWaterMark(connection: IdentityTransitionGateConnection): Promise<number> {
    const [rows] = await connection.execute<SourceMutationHighWaterMarkRow[]>(
      `SELECT sequence AS sourceHighWaterMark
       FROM identity_source_mutation_watermark WHERE id = 1 FOR UPDATE`,
    );
    const sourceHighWaterMark = Number(rows[0]?.sourceHighWaterMark ?? -1);
    if (!Number.isSafeInteger(sourceHighWaterMark) || sourceHighWaterMark < 0) return -1;
    return sourceHighWaterMark;
  }

  async loadRelationshipInvariantAggregates(
    connection: IdentityTransitionGateConnection,
  ): Promise<IdentityRelationshipInvariantAggregateRow[]> {
    const [rows] = await connection.query<IdentityRelationshipInvariantAggregateRow[]>(
      `SELECT 'ACTIVE_CYCLE_NUMBER_POLICY' AS invariantCode, COUNT(*) AS violationCount
       FROM exam_cycle cycle
       LEFT JOIN number_uniqueness_policy policy ON policy.exam_cycle_id = cycle.id
       WHERE cycle.status = 'ACTIVE' AND policy.exam_cycle_id IS NULL
       UNION ALL
       SELECT 'CANDIDATE_REGISTRATION_CYCLE', COUNT(*)
       FROM candidate_registration registration
       INNER JOIN candidate candidate_identity ON candidate_identity.id = registration.candidate_id
       INNER JOIN schedule_segment segment ON segment.id = registration.schedule_segment_id
       INNER JOIN operation_slot slot ON slot.id = segment.operation_slot_id
       INNER JOIN admission ON admission.id = slot.admission_id
       WHERE candidate_identity.exam_cycle_id <> admission.exam_cycle_id
       UNION ALL
       SELECT 'CANDIDATE_REGISTRATION_SLOT', COUNT(*)
       FROM candidate_registration registration
       INNER JOIN schedule_segment segment ON segment.id = registration.schedule_segment_id
       LEFT JOIN candidate_registration_slot_claim claim ON claim.registration_id = registration.id
       WHERE claim.registration_id IS NULL
          OR claim.candidate_id <> registration.candidate_id
          OR claim.operation_slot_id <> segment.operation_slot_id
       UNION ALL
       SELECT 'PSEUDONYM_POLICY_ADMISSION_CYCLE', COUNT(*)
       FROM pseudonym_policy policy
       LEFT JOIN admission ON admission.id = policy.admission_id
       WHERE policy.scope_key <> ${EXPECTED_POLICY_SCOPE_KEY_SQL}
          OR (policy.scope_kind = 'ADMISSION'
              AND (admission.id IS NULL OR admission.exam_cycle_id <> policy.exam_cycle_id))
       UNION ALL
       SELECT 'PSEUDONYM_RANGE_POLICY_SEGMENT', COUNT(*)
       FROM pseudonym_range range_row
       INNER JOIN pseudonym_policy policy ON policy.id = range_row.pseudonym_policy_id
       INNER JOIN schedule_segment segment ON segment.id = range_row.schedule_segment_id
       INNER JOIN operation_slot slot ON slot.id = segment.operation_slot_id
       INNER JOIN admission ON admission.id = slot.admission_id
       WHERE policy.exam_cycle_id <> admission.exam_cycle_id
          OR (policy.scope_kind = 'ADMISSION' AND policy.admission_id <> admission.id)
       UNION ALL
       SELECT 'ASSIGNMENT_REGISTRATION_OPERATION', COUNT(*)
       FROM (
         SELECT assignment.id AS violationId
         FROM candidate_pseudonym_assignment assignment
         INNER JOIN candidate_registration registration ON registration.id = assignment.registration_id
         INNER JOIN schedule_segment segment ON segment.id = registration.schedule_segment_id
         INNER JOIN pseudonym_operation_state operation ON operation.id = assignment.pseudonym_operation_id
         WHERE segment.operation_slot_id <> operation.operation_slot_id
         UNION ALL
         SELECT assignment.id
         FROM candidate_pseudonym_assignment assignment
         WHERE NOT EXISTS (
           SELECT 1
           FROM pseudonym_assignment_event assignment_event
           WHERE assignment_event.assignment_id = assignment.id
             AND assignment_event.registration_id = assignment.registration_id
             AND assignment_event.operation_id = assignment.pseudonym_operation_id
             AND assignment_event.event_type IN ('ASSIGNED', 'ABSENTEE_AUTO_ASSIGNED')
             AND assignment_event.pseudonym_value = assignment.pseudonym_value
             AND assignment_event.display_width = assignment.display_width
             AND assignment_event.assignment_mode = assignment.assignment_mode
         )
       ) AS assignment_violation
       UNION ALL
       SELECT 'CANDIDATE_NUMBER_CLAIM_SCOPE', COUNT(*)
       FROM (
         SELECT claim.id AS violationId
         FROM candidate_number_claim claim
         INNER JOIN candidate candidate_identity ON candidate_identity.id = claim.candidate_id
         LEFT JOIN number_uniqueness_policy policy ON policy.exam_cycle_id = candidate_identity.exam_cycle_id
         LEFT JOIN candidate_registration registration ON registration.id = claim.registration_id
         LEFT JOIN schedule_segment segment ON segment.id = registration.schedule_segment_id
         LEFT JOIN operation_slot slot ON slot.id = segment.operation_slot_id
         LEFT JOIN admission ON admission.id = slot.admission_id
         WHERE claim.exam_cycle_id <> candidate_identity.exam_cycle_id
            OR claim.examinee_no_canonical <> candidate_identity.examinee_no_canonical
            OR policy.exam_cycle_id IS NULL
            OR claim.scope_kind <> policy.examinee_scope
            OR claim.scope_key <> ${EXPECTED_CANDIDATE_SCOPE_KEY_SQL}
            OR claim.owner_key <> ${EXPECTED_CANDIDATE_OWNER_KEY_SQL}
            OR (claim.scope_kind = 'SYSTEM'
                AND (claim.registration_id IS NOT NULL OR claim.operation_slot_id IS NOT NULL))
            OR (claim.scope_kind = 'SCHEDULE'
                AND (registration.id IS NULL
                  OR registration.candidate_id <> claim.candidate_id
                  OR segment.operation_slot_id <> claim.operation_slot_id
                  OR admission.exam_cycle_id <> claim.exam_cycle_id))
         UNION ALL
         SELECT candidate_identity.id
         FROM candidate candidate_identity
         INNER JOIN number_uniqueness_policy policy ON policy.exam_cycle_id = candidate_identity.exam_cycle_id
         WHERE candidate_identity.status = 'ACTIVE' AND policy.examinee_scope = 'SYSTEM'
           AND NOT EXISTS (
             SELECT 1 FROM candidate_number_claim required_claim
             WHERE required_claim.candidate_id = candidate_identity.id
               AND required_claim.scope_kind = 'SYSTEM'
           )
         UNION ALL
         SELECT registration.id
         FROM candidate_registration registration
         INNER JOIN candidate candidate_identity ON candidate_identity.id = registration.candidate_id
         INNER JOIN number_uniqueness_policy policy ON policy.exam_cycle_id = candidate_identity.exam_cycle_id
         WHERE registration.status = 'ACTIVE' AND policy.examinee_scope = 'SCHEDULE'
           AND NOT EXISTS (
             SELECT 1 FROM candidate_number_claim required_claim
             WHERE required_claim.registration_id = registration.id
               AND required_claim.scope_kind = 'SCHEDULE'
           )
       ) AS candidate_claim_violation
       UNION ALL
       SELECT 'PSEUDONYM_NUMBER_CLAIM_SCOPE', COUNT(*)
       FROM (
         SELECT claim.id AS violationId
         FROM pseudonym_number_claim claim
         INNER JOIN candidate_pseudonym_assignment assignment ON assignment.id = claim.assignment_id
         INNER JOIN candidate_registration registration ON registration.id = assignment.registration_id
         INNER JOIN candidate candidate_identity ON candidate_identity.id = registration.candidate_id
         INNER JOIN schedule_segment segment ON segment.id = registration.schedule_segment_id
         INNER JOIN operation_slot slot ON slot.id = segment.operation_slot_id
         INNER JOIN admission ON admission.id = slot.admission_id
         INNER JOIN pseudonym_operation_state operation ON operation.id = assignment.pseudonym_operation_id
         LEFT JOIN number_uniqueness_policy policy ON policy.exam_cycle_id = candidate_identity.exam_cycle_id
         WHERE policy.exam_cycle_id IS NULL
            OR claim.scope_kind <> policy.pseudonym_scope
            OR candidate_identity.exam_cycle_id <> admission.exam_cycle_id
            OR claim.admission_id <> admission.id
            OR claim.pseudonym_value <> assignment.pseudonym_value
            OR claim.scope_key <> ${EXPECTED_PSEUDONYM_SCOPE_KEY_SQL}
            OR operation.operation_slot_id <> slot.id
            OR (claim.scope_kind = 'ADMISSION' AND claim.operation_slot_id IS NOT NULL)
            OR (claim.scope_kind = 'SCHEDULE'
                AND (claim.operation_slot_id IS NULL OR claim.operation_slot_id <> slot.id))
         UNION ALL
         SELECT assignment.id
         FROM candidate_pseudonym_assignment assignment
         WHERE NOT EXISTS (
           SELECT 1 FROM pseudonym_number_claim required_claim
           WHERE required_claim.assignment_id = assignment.id
         )
       ) AS pseudonym_claim_violation
       UNION ALL
       SELECT 'PRINT_REFERENCE_GRAPH', COUNT(*)
       FROM print_job job
       LEFT JOIN candidate_registration registration ON registration.id = job.candidate_registration_id
       LEFT JOIN schedule_segment segment ON segment.id = registration.schedule_segment_id
       LEFT JOIN candidate_pseudonym_assignment assignment ON assignment.id = job.canonical_assignment_id
       LEFT JOIN pseudonym_operation_state operation ON operation.id = assignment.pseudonym_operation_id
       LEFT JOIN print_projection_snapshot snapshot ON snapshot.print_job_id = job.id
       WHERE snapshot.print_job_id IS NULL
          OR snapshot.projection_digest NOT REGEXP '^[0-9A-Fa-f]{64}$'
          OR (job.candidate_registration_id IS NULL
              AND (job.canonical_assignment_id IS NOT NULL OR job.operation_slot_id IS NOT NULL))
          OR (job.candidate_registration_id IS NOT NULL
              AND (registration.id IS NULL
                OR job.operation_slot_id IS NULL
                OR job.operation_slot_id <> segment.operation_slot_id))
          OR (job.canonical_assignment_id IS NOT NULL
              AND (assignment.id IS NULL
                OR assignment.registration_id <> job.candidate_registration_id
                OR operation.operation_slot_id <> job.operation_slot_id))`,
    );
    return rows;
  }

  async loadRangeValidationSnapshot(
    connection: IdentityTransitionGateConnection,
  ): Promise<IdentityRangeValidationSnapshot> {
    const [admissions] = await connection.query<IdentityRangeAdmissionRow[]>(
      `SELECT admission.id AS admissionId, uniqueness_policy.pseudonym_scope AS policyScope,
              (SELECT COUNT(*)
               FROM candidate_registration registration
               INNER JOIN schedule_segment segment ON segment.id = registration.schedule_segment_id
               INNER JOIN operation_slot slot ON slot.id = segment.operation_slot_id
               WHERE slot.admission_id = admission.id AND registration.status = 'ACTIVE') AS targetCount
       FROM admission
       INNER JOIN exam_cycle cycle ON cycle.id = admission.exam_cycle_id
       INNER JOIN pseudonym_policy effective_policy
         ON effective_policy.exam_cycle_id = admission.exam_cycle_id
        AND effective_policy.assignment_method IN ('DRAW', 'SEQUENTIAL')
        AND (
          (effective_policy.scope_kind = 'ADMISSION' AND effective_policy.admission_id = admission.id)
          OR (
            effective_policy.scope_kind = 'DEFAULT'
            AND NOT EXISTS (
              SELECT 1 FROM pseudonym_policy admission_policy
              WHERE admission_policy.scope_kind = 'ADMISSION'
                AND admission_policy.exam_cycle_id = admission.exam_cycle_id
                AND admission_policy.admission_id = admission.id
            )
          )
        )
       LEFT JOIN number_uniqueness_policy uniqueness_policy ON uniqueness_policy.exam_cycle_id = cycle.id
       WHERE cycle.status = 'ACTIVE' AND admission.status = 'ACTIVE'
       ORDER BY admission.id`,
    );
    const [slots] = await connection.query<IdentityRangeSlotRow[]>(
      `SELECT admission.id AS admissionId, slot.id AS slotId,
              (SELECT COUNT(*)
               FROM candidate_registration registration
               INNER JOIN schedule_segment segment ON segment.id = registration.schedule_segment_id
               WHERE segment.operation_slot_id = slot.id AND registration.status = 'ACTIVE') AS targetCount
       FROM operation_slot slot
       INNER JOIN admission ON admission.id = slot.admission_id
       INNER JOIN exam_cycle cycle ON cycle.id = admission.exam_cycle_id
       INNER JOIN pseudonym_policy effective_policy
         ON effective_policy.exam_cycle_id = admission.exam_cycle_id
        AND effective_policy.assignment_method IN ('DRAW', 'SEQUENTIAL')
        AND (
          (effective_policy.scope_kind = 'ADMISSION' AND effective_policy.admission_id = admission.id)
          OR (
            effective_policy.scope_kind = 'DEFAULT'
            AND NOT EXISTS (
              SELECT 1 FROM pseudonym_policy admission_policy
              WHERE admission_policy.scope_kind = 'ADMISSION'
                AND admission_policy.exam_cycle_id = admission.exam_cycle_id
                AND admission_policy.admission_id = admission.id
            )
          )
        )
       WHERE cycle.status = 'ACTIVE' AND admission.status = 'ACTIVE' AND slot.status = 'ACTIVE'
       ORDER BY admission.id, slot.id`,
    );
    const [segments] = await connection.query<IdentityRangeSegmentRow[]>(
      `SELECT admission.id AS admissionId, slot.id AS slotId, segment.id AS segmentId,
              range_row.range_start_value AS rangeStart, range_row.range_end_value AS rangeEnd
       FROM pseudonym_range range_row
       INNER JOIN pseudonym_policy policy ON policy.id = range_row.pseudonym_policy_id
       INNER JOIN schedule_segment segment ON segment.id = range_row.schedule_segment_id
       INNER JOIN operation_slot slot ON slot.id = segment.operation_slot_id
       INNER JOIN admission ON admission.id = slot.admission_id
       INNER JOIN exam_cycle cycle ON cycle.id = admission.exam_cycle_id
       WHERE cycle.status = 'ACTIVE' AND admission.status = 'ACTIVE'
         AND slot.status = 'ACTIVE' AND segment.status = 'ACTIVE'
         AND policy.exam_cycle_id = admission.exam_cycle_id
         AND policy.assignment_method IN ('DRAW', 'SEQUENTIAL')
         AND (
           (policy.scope_kind = 'ADMISSION' AND policy.admission_id = admission.id)
           OR (
             policy.scope_kind = 'DEFAULT'
             AND NOT EXISTS (
               SELECT 1 FROM pseudonym_policy admission_policy
               WHERE admission_policy.scope_kind = 'ADMISSION'
                 AND admission_policy.exam_cycle_id = admission.exam_cycle_id
                 AND admission_policy.admission_id = admission.id
             )
           )
         )
       ORDER BY admission.id, slot.id, segment.id, range_row.id`,
    );
    return { admissions, slots, segments };
  }

  async countCanaryTargets(connection: IdentityTransitionGateConnection): Promise<number> {
    const [rows] = await connection.query<CountRow[]>(
      `SELECT (SELECT COUNT(*) FROM identity_canary_user)
              + (SELECT COUNT(*) FROM identity_canary_admission) AS count`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  async updateState(
    connection: IdentityTransitionGateConnection,
    state: IdentityTransitionStateRow,
    target: IdentityTransitionTargetState,
    nextVersion: number,
    actorUserId: number,
  ): Promise<boolean> {
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE identity_transition_state
       SET write_mode = ?, read_mode = ?, phase = ?, version = ?, updated_by = ?
       WHERE id = 1 AND version = ?`,
      [target.writeMode, target.readMode, target.phase, nextVersion, actorUserId, state.version],
    );
    return result.affectedRows === 1;
  }

  async insertHistory(
    connection: IdentityTransitionGateConnection,
    input: {
      requestId: string | null;
      eventType: "PROMOTION" | "EMERGENCY_ROLLBACK";
      state: IdentityTransitionStateRow;
      target: IdentityTransitionTargetState;
      nextVersion: number;
      reasonCode: string;
      actorUserId: number;
    },
  ): Promise<number> {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO identity_transition_state_history
        (request_id, event_type, from_write_mode, from_read_mode, from_phase,
         to_write_mode, to_read_mode, to_phase, from_state_version, to_state_version,
         reason_code, actor_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.requestId,
        input.eventType,
        input.state.writeMode,
        input.state.readMode,
        input.state.phase,
        input.target.writeMode,
        input.target.readMode,
        input.target.phase,
        input.state.version,
        input.nextVersion,
        input.reasonCode,
        input.actorUserId,
      ],
    );
    return Number(result.insertId);
  }

  async linkHistoryEvidence(
    connection: IdentityTransitionGateConnection,
    historyId: number,
    evidenceIds: readonly string[],
  ): Promise<void> {
    for (const evidenceId of new Set(evidenceIds)) {
      await connection.execute(
        `INSERT INTO identity_transition_history_evidence (history_id, evidence_id)
         VALUES (?, ?)`,
        [historyId, evidenceId],
      );
    }
  }

  async markRequestApplied(
    connection: IdentityTransitionGateConnection,
    requestId: string,
    actorUserId: number,
    canonicalManualConfirmed: boolean,
  ): Promise<boolean> {
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE identity_transition_request
       SET status = 'APPLIED', applied_by = ?, applied_at = CURRENT_TIMESTAMP(3),
           canonical_manual_confirmed_by = ?
       WHERE id = ? AND status = 'PENDING'`,
      [actorUserId, canonicalManualConfirmed ? actorUserId : null, requestId],
    );
    return result.affectedRows === 1;
  }
}

function identityDigestSql(namespace: string, valueExpressions: readonly string[]): string {
  const expressions = [sqlLiteral("examcheck-identity:v1"), sqlLiteral(namespace), ...valueExpressions];
  const bytes = expressions.map((expression) => `UNHEX(LPAD(HEX(OCTET_LENGTH(${expression})), 8, '0')), ${expression}`);
  return `UNHEX(SHA2(CONCAT(${bytes.join(", ")}), 256))`;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
