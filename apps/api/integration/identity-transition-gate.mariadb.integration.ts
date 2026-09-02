import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admissionPolicyScopeKey,
  candidateClaimOwnerKey,
  candidateSystemScopeKey,
  defaultPolicyScopeKey,
  pseudonymAdmissionScopeKey,
} from "../src/identity-transition/identity-keys.js";
import { IdentityTransitionGateRepository } from "../src/identity-transition/identity-transition-gate.repository.js";
import {
  IdentityTransitionGateService,
  requiredApprovalsForStage,
  requiredEvidenceForStage,
  type IdentityTransitionApprovalType,
  type IdentityTransitionEvidenceType,
  type IdentityTransitionTargetStage,
} from "../src/identity-transition/identity-transition-gate.service.js";
import {
  IDENTITY_SHADOW_OBSERVATION_TYPES,
  type IdentityShadowObservationType,
} from "../src/identity-transition/identity-shadow-snapshot.repository.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

describe("identity transition promotion gate on MariaDB", () => {
  let harness: MariaDbIntegrationHarness;
  let connection: PoolConnection;
  const service = new IdentityTransitionGateService();

  beforeAll(async () => {
    harness = await createMariaDbIntegrationHarness();
    connection = await harness.pool.getConnection();
  });

  afterAll(async () => {
    connection.release();
    await harness.cleanup();
  });

  it("applies 034 as expand-only gate, fails closed, promotes in order and records emergency rollback", async () => {
    const users = await insertUsers(5);
    const requester = users[0]!;
    const approvalActors: Record<IdentityTransitionApprovalType, number> = {
      OPERATIONS: users[1]!,
      DATA_OWNER: users[2]!,
      PRIVACY: users[3]!,
      CANONICAL_OWNER: users[4]!,
    };
    const evidence = await recordEvidenceSet(users[1]!, users[2]!);
    const backfillRunId = randomUUID();
    await connection.execute(
      `INSERT INTO identity_backfill_run
        (id, status, source_high_water_mark, exact_count, issue_count, completed_at)
       VALUES (?, 'SUCCEEDED', 138, 138, 0, CURRENT_TIMESTAMP(3))`,
      [backfillRunId],
    );
    await connection.execute(
      `UPDATE identity_transition_state
       SET phase = 'BACKFILLED', last_backfill_run_id = ?, version = 2
       WHERE id = 1`,
      [backfillRunId],
    );

    const dualRequest = await createPreparedRequest({
      stage: "DUAL",
      expectedVersion: 2,
      requester,
      evidence,
      approvalActors,
    });
    await connection.execute(
      `INSERT INTO identity_migration_issue
        (run_id, entity_type, source_id, issue_code, status)
       VALUES (?, 'pseudonym_range_validation', 1, 'ADMISSION_RANGE_OVERLAP', 'OPEN')`,
      [backfillRunId],
    );
    await expect(
      service.applyRequest(connection, { requestId: dualRequest, actorUserId: requester }),
    ).rejects.toMatchObject({ code: "OPEN_BLOCKING_ISSUES" });
    await expectState("LEGACY", "LEGACY", "BACKFILLED", 2);
    await connection.execute(
      `UPDATE identity_migration_issue SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP(3)
       WHERE run_id = ? AND status = 'OPEN'`,
      [backfillRunId],
    );
    const graph = await insertRangeValidationGraph(requester);
    const effectiveRanges = await new IdentityTransitionGateRepository().loadRangeValidationSnapshot(connection);
    expect(
      effectiveRanges.segments.filter((segment) => Number(segment.admissionId) === graph.admissionId),
    ).toHaveLength(2);
    expect(
      effectiveRanges.segments.filter((segment) => Number(segment.admissionId) === graph.fallbackAdmissionId),
    ).toHaveLength(1);
    expect(
      effectiveRanges.admissions.some((admission) => Number(admission.admissionId) === graph.matchingAdmissionId),
    ).toBe(false);
    expect(effectiveRanges.slots.some((slot) => Number(slot.slotId) === graph.matchingSlotId)).toBe(false);
    await connection.execute("UPDATE candidate SET exam_cycle_id = ? WHERE id = ?", [
      graph.otherCycleId,
      graph.candidateId,
    ]);
    await expect(
      service.applyRequest(connection, { requestId: dualRequest, actorUserId: requester }),
    ).rejects.toMatchObject({ code: "TARGET_RELATIONSHIP_INVARIANT_FAILED" });
    await connection.execute("UPDATE candidate SET exam_cycle_id = ? WHERE id = ?", [graph.cycleId, graph.candidateId]);
    await expect(
      service.applyRequest(connection, { requestId: dualRequest, actorUserId: requester }),
    ).rejects.toMatchObject({ code: "RANGE_VALIDATION_FAILED" });
    await connection.execute(
      `UPDATE pseudonym_range
       SET range_start_value = 2, range_end_value = 2, next_value = 2
       WHERE id = ?`,
      [graph.overlappingRangeId],
    );
    await connection.execute("UPDATE candidate_number_claim SET scope_key = ? WHERE id = ?", [
      syntheticDigest(250),
      graph.candidateClaimId,
    ]);
    await expect(
      service.applyRequest(connection, { requestId: dualRequest, actorUserId: requester }),
    ).rejects.toMatchObject({ code: "TARGET_RELATIONSHIP_INVARIANT_FAILED" });
    await connection.execute("UPDATE candidate_number_claim SET scope_key = ? WHERE id = ?", [
      candidateSystemScopeKey(graph.cycleId),
      graph.candidateClaimId,
    ]);
    await connection.execute("DELETE FROM candidate_number_claim WHERE id = ?", [graph.secondaryCandidateClaimId]);
    await expect(
      service.applyRequest(connection, { requestId: dualRequest, actorUserId: requester }),
    ).rejects.toMatchObject({ code: "TARGET_RELATIONSHIP_INVARIANT_FAILED" });
    await insertSystemCandidateClaim(graph.secondaryCandidateId, graph.cycleId, "T-2");
    await connection.execute("DELETE FROM pseudonym_number_claim WHERE assignment_id = ?", [graph.assignmentId]);
    await expect(
      service.applyRequest(connection, { requestId: dualRequest, actorUserId: requester }),
    ).rejects.toMatchObject({ code: "TARGET_RELATIONSHIP_INVARIANT_FAILED" });
    await insertPseudonymClaim(graph.assignmentId, graph.admissionId);
    const missingEventAssignmentId = await insertId(
      `INSERT INTO candidate_pseudonym_assignment
        (registration_id, pseudonym_operation_id, pseudonym_value,
         assignment_mode, assigned_by)
       VALUES (?, ?, 2, 'MANUAL', ?)`,
      [graph.secondaryRegistrationId, graph.operationId, requester],
    );
    await insertPseudonymClaim(missingEventAssignmentId, graph.admissionId, 2);
    await expect(
      service.applyRequest(connection, { requestId: dualRequest, actorUserId: requester }),
    ).rejects.toMatchObject({ code: "TARGET_RELATIONSHIP_INVARIANT_FAILED" });
    await insertAssignmentEvent({
      assignmentId: missingEventAssignmentId,
      registrationId: graph.secondaryRegistrationId,
      operationId: graph.operationId,
      actorUserId: requester,
      pseudonymValue: 2,
    });
    const printJobId = randomUUID();
    await connection.execute(
      `INSERT INTO print_job
        (id, job_no, label_type, template_id, template_version, requested_by,
         copies, status, expires_at)
       SELECT ?, ?, 'PRINTER_TEST', template.id, template.version, ?, 1, 'READY',
              DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)
       FROM label_template template
       WHERE template.code = 'PRINTER_TEST' AND template.version = 1
       LIMIT 1`,
      [printJobId, `TRANSITION-${randomUUID()}`, requester],
    );
    await expect(
      service.applyRequest(connection, { requestId: dualRequest, actorUserId: requester }),
    ).rejects.toMatchObject({ code: "TARGET_RELATIONSHIP_INVARIANT_FAILED" });
    await connection.execute(
      `INSERT INTO print_projection_snapshot (print_job_id, projection_json, projection_digest)
       VALUES (?, JSON_OBJECT('projectionVersion', 1), ?)`,
      [printJobId, "a".repeat(64)],
    );
    const invalidDigestJobId = randomUUID();
    await connection.beginTransaction();
    try {
      await connection.execute(
        `INSERT INTO print_job
          (id, job_no, label_type, template_id, template_version, requested_by,
           copies, status, expires_at)
         SELECT ?, ?, 'PRINTER_TEST', template.id, template.version, ?, 1, 'READY',
                DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)
         FROM label_template template
         WHERE template.code = 'PRINTER_TEST' AND template.version = 1
         LIMIT 1`,
        [invalidDigestJobId, `TRANSITION-INVALID-${randomUUID()}`, requester],
      );
      await connection.execute(
        `INSERT INTO print_projection_snapshot (print_job_id, projection_json, projection_digest)
         VALUES (?, JSON_OBJECT('projectionVersion', 1), ?)`,
        [invalidDigestJobId, "z".repeat(64)],
      );
      const invalidDigestAggregates = await new IdentityTransitionGateRepository().loadRelationshipInvariantAggregates(
        connection,
      );
      expect(
        Number(invalidDigestAggregates.find((row) => row.invariantCode === "PRINT_REFERENCE_GRAPH")?.violationCount),
      ).toBe(1);
    } finally {
      await connection.rollback();
    }
    await expect(service.applyRequest(connection, { requestId: dualRequest, actorUserId: requester })).resolves.toEqual(
      { writeMode: "DUAL", readMode: "LEGACY", phase: "BACKFILLED", version: 3 },
    );

    const shadowRequest = await createPreparedRequest({
      stage: "SHADOW",
      expectedVersion: 3,
      requester,
      evidence,
      approvalActors,
    });
    await expect(
      service.applyRequest(connection, { requestId: shadowRequest, actorUserId: requester }),
    ).resolves.toEqual({ writeMode: "DUAL", readMode: "SHADOW", phase: "SHADOWING", version: 4 });

    await moveLatestPhaseStartBack("SHADOWING", 10);
    await insertObservationSet({
      observedMinutesAgo: 6,
      match: 60,
      mismatchType: IDENTITY_SHADOW_OBSERVATION_TYPES[0],
    });
    await insertObservationSet({ observedMinutesAgo: 0, match: 60 });
    const canaryRequest = await createPreparedRequest({
      stage: "CANARY",
      expectedVersion: 4,
      requester,
      evidence,
      approvalActors,
      minimumComparedEntityCount: 100,
      minimumObservationMinutes: 5,
    });
    await connection.execute(
      `UPDATE identity_transition_gate_evidence
       SET observed_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR)
       WHERE id = ?`,
      [evidence.TARGET_READ_CONTRACT_READY],
    );
    await expect(
      service.applyRequest(connection, { requestId: canaryRequest, actorUserId: requester }),
    ).rejects.toMatchObject({ code: "REQUIRED_EVIDENCE_MISSING" });
    await connection.execute(
      `UPDATE identity_transition_gate_evidence
       SET observed_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR)
       WHERE id = ?`,
      [evidence.TARGET_READ_CONTRACT_READY],
    );
    await expect(
      service.applyRequest(connection, { requestId: canaryRequest, actorUserId: requester }),
    ).rejects.toMatchObject({ code: "CANARY_TARGET_MISSING" });
    await connection.execute("INSERT INTO identity_canary_user (user_id) VALUES (?)", [requester]);
    await connection.execute("DELETE FROM identity_shadow_observation");
    await insertObservationSet({
      observedMinutesAgo: 6,
      match: 60,
      excludedType: IDENTITY_SHADOW_OBSERVATION_TYPES.at(-1),
    });
    await insertObservationSet({
      observedMinutesAgo: 0,
      match: 60,
      excludedType: IDENTITY_SHADOW_OBSERVATION_TYPES.at(-1),
    });
    await expect(
      service.applyRequest(connection, { requestId: canaryRequest, actorUserId: requester }),
    ).rejects.toMatchObject({ code: "OBSERVATION_WINDOW_MISSING" });
    await connection.execute("DELETE FROM identity_shadow_observation");
    await insertObservationSet({
      observedMinutesAgo: 6,
      match: 60,
      mismatchType: IDENTITY_SHADOW_OBSERVATION_TYPES[0],
    });
    await insertObservationSet({ observedMinutesAgo: 0, match: 60 });
    await expect(
      service.applyRequest(connection, { requestId: canaryRequest, actorUserId: requester }),
    ).rejects.toMatchObject({ code: "SHADOW_COMPARISON_FAILED" });
    await expectState("DUAL", "SHADOW", "SHADOWING", 4);

    await connection.execute("DELETE FROM identity_shadow_observation");
    await insertObservationSet({ observedMinutesAgo: 6, match: 60 });
    await insertObservationSet({ observedMinutesAgo: 0, match: 60 });
    const watermarkBeforeAuth = await sourceMutationSequence();
    await connection.execute(
      `INSERT INTO audit_log (event_type, actor_user_id, details)
       VALUES ('AUTH_LOGIN_SUCCEEDED', ?, JSON_OBJECT('synthetic', TRUE))`,
      [requester],
    );
    expect(await sourceMutationSequence()).toBe(watermarkBeforeAuth);
    await connection.execute(
      `INSERT INTO audit_log (event_type, actor_user_id, details)
       VALUES ('SYSTEM_PROFILE_UPDATED', ?, JSON_OBJECT('synthetic', TRUE))`,
      [requester],
    );
    expect(await sourceMutationSequence()).toBe(watermarkBeforeAuth + 1);
    await expect(
      service.applyRequest(connection, { requestId: canaryRequest, actorUserId: requester }),
    ).rejects.toMatchObject({ code: "OBSERVATION_WATERMARK_STALE" });
    await insertObservationSet({ observedMinutesAgo: 0, match: 60 });
    await expect(
      service.applyRequest(connection, { requestId: canaryRequest, actorUserId: requester }),
    ).resolves.toEqual({ writeMode: "DUAL", readMode: "CANARY", phase: "CANARY", version: 5 });

    await moveLatestPhaseStartBack("CANARY", 10);
    await connection.execute("DELETE FROM identity_shadow_observation");
    await insertObservationSet({ observedMinutesAgo: 6, match: 75 });
    await insertObservationSet({ observedMinutesAgo: 0, match: 75 });
    const canonicalRequest = await createPreparedRequest({
      stage: "CANONICAL",
      expectedVersion: 5,
      requester,
      evidence,
      approvalActors,
      minimumComparedEntityCount: 120,
      minimumObservationMinutes: 5,
    });
    await expect(
      service.applyRequest(connection, { requestId: canonicalRequest, actorUserId: requester }),
    ).rejects.toMatchObject({ code: "MANUAL_CANONICAL_CONFIRMATION_REQUIRED" });
    await expectState("DUAL", "CANARY", "CANARY", 5);
    await expect(
      service.applyRequest(connection, {
        requestId: canonicalRequest,
        actorUserId: requester,
        manualCanonicalConfirmation: true,
      }),
    ).resolves.toEqual({ writeMode: "CANONICAL", readMode: "CANONICAL", phase: "CANONICAL", version: 6 });

    await expect(
      service.emergencyRollback(connection, {
        target: "DUAL",
        actorUserId: requester,
        reasonCode: "INCIDENT:TARGET-READ",
        evidenceIds: [evidence.TARGET_WRITE_CONTRACT_READY],
      }),
    ).resolves.toEqual({ writeMode: "DUAL", readMode: "LEGACY", phase: "BACKFILLED", version: 7 });
    await expect(
      service.emergencyRollback(connection, {
        target: "LEGACY",
        actorUserId: requester,
        reasonCode: "INCIDENT:FAILSAFE",
        maximumRollbackMinutes: 1,
        evidenceIds: [evidence.ROLLBACK_REHEARSAL],
      }),
    ).resolves.toEqual({ writeMode: "LEGACY", readMode: "LEGACY", phase: "BLOCKED", version: 8 });

    const [historyRows] = await connection.query<
      Array<RowDataPacket & { eventType: string; requestId: string | null; fromVersion: number; toVersion: number }>
    >(
      `SELECT event_type AS eventType, request_id AS requestId,
              from_state_version AS fromVersion, to_state_version AS toVersion
       FROM identity_transition_state_history ORDER BY id`,
    );
    expect(historyRows).toHaveLength(6);
    expect(historyRows.slice(-2)).toEqual([
      { eventType: "EMERGENCY_ROLLBACK", requestId: null, fromVersion: 6, toVersion: 7 },
      { eventType: "EMERGENCY_ROLLBACK", requestId: null, fromVersion: 7, toVersion: 8 },
    ]);
    const [canonicalRows] = await connection.execute<
      Array<RowDataPacket & { status: string; confirmedBy: number | null }>
    >(
      `SELECT status, canonical_manual_confirmed_by AS confirmedBy
       FROM identity_transition_request WHERE id = ?`,
      [canonicalRequest],
    );
    expect(canonicalRows).toEqual([{ status: "APPLIED", confirmedBy: requester }]);
  });

  async function createPreparedRequest(input: {
    stage: IdentityTransitionTargetStage;
    expectedVersion: number;
    requester: number;
    evidence: Record<IdentityTransitionEvidenceType, string>;
    approvalActors: Record<IdentityTransitionApprovalType, number>;
    minimumComparedEntityCount?: number;
    minimumObservationMinutes?: number;
  }): Promise<string> {
    const { requestId } = await service.createRequest(connection, {
      targetStage: input.stage,
      expectedStateVersion: input.expectedVersion,
      reasonCode: `PROMOTE:${input.stage}`,
      ...(input.minimumComparedEntityCount === undefined
        ? {}
        : { minimumComparedEntityCount: input.minimumComparedEntityCount }),
      ...(input.minimumObservationMinutes === undefined
        ? {}
        : { minimumObservationMinutes: input.minimumObservationMinutes }),
      maximumRollbackMinutes: 15,
      requestedBy: input.requester,
    });
    for (const type of requiredEvidenceForStage(input.stage)) {
      await service.attachEvidence(connection, {
        requestId,
        evidenceId: input.evidence[type],
        actorUserId: input.requester,
      });
    }
    for (const approvalType of requiredApprovalsForStage(input.stage)) {
      await service.approveRequest(connection, {
        requestId,
        approvalType,
        approvedBy: input.approvalActors[approvalType],
      });
    }
    return requestId;
  }

  async function recordEvidenceSet(
    recordedBy: number,
    verifiedBy: number,
  ): Promise<Record<IdentityTransitionEvidenceType, string>> {
    const observedAt = new Date(Date.now() - 60 * 60_000);
    const validUntil = new Date(Date.now() + 24 * 60 * 60_000);
    const result = {} as Record<IdentityTransitionEvidenceType, string>;
    for (const type of [
      "BACKUP_RESTORE",
      "ROLLBACK_REHEARSAL",
      "TARGET_READ_CONTRACT_READY",
      "TARGET_WRITE_CONTRACT_READY",
      "CANARY_VALIDATION",
      "LEGACY_COMPATIBILITY",
    ] as const) {
      const recorded = await service.recordEvidence(connection, {
        evidenceType: type,
        result: "PASSED",
        referenceCode: `IT:${type}`,
        ...(type === "ROLLBACK_REHEARSAL" ? { elapsedMinutes: 5 } : {}),
        observedAt,
        validUntil,
        recordedBy,
        verifiedBy,
      });
      result[type] = recorded.evidenceId;
    }
    return result;
  }

  async function insertUsers(count: number): Promise<number[]> {
    const ids: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO app_user (login_id, role, enabled)
         VALUES (?, 'DEVELOPER', TRUE)`,
        [`transition-${index}-${randomUUID()}`],
      );
      ids.push(Number(result.insertId));
    }
    return ids;
  }

  async function moveLatestPhaseStartBack(phase: string, minutes: number): Promise<void> {
    await connection.execute(
      `UPDATE identity_transition_state_history
       SET created_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE)
       WHERE id = (
         SELECT id FROM (
           SELECT id FROM identity_transition_state_history
           WHERE to_phase = ? ORDER BY id DESC LIMIT 1
         ) AS selected_history
       )`,
      [minutes, phase],
    );
  }

  async function insertObservationSet(input: {
    observedMinutesAgo: number;
    match: number;
    mismatchType?: IdentityShadowObservationType;
    excludedType?: IdentityShadowObservationType;
  }): Promise<void> {
    const verificationBatchId = randomUUID();
    const sourceHighWaterMark = await sourceMutationSequence();
    await connection.execute(
      `INSERT INTO identity_shadow_verification_batch (id, status, observation_count, started_at)
       VALUES (?, 'RUNNING', 0, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE))`,
      [verificationBatchId, input.observedMinutesAgo],
    );
    let observationCount = 0;
    for (const observationType of IDENTITY_SHADOW_OBSERVATION_TYPES) {
      if (observationType === input.excludedType) continue;
      const mismatch = observationType === input.mismatchType ? 1 : 0;
      await connection.execute(
        `INSERT INTO identity_shadow_observation
          (verification_batch_id, observation_type, source_high_water_mark, old_row_count, new_row_count,
           match_count, mismatch_count, old_only_count, new_only_count, ambiguous_count, observed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0,
                 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE))`,
        [
          verificationBatchId,
          observationType,
          sourceHighWaterMark,
          input.match + mismatch,
          input.match + mismatch,
          input.match,
          mismatch,
          input.observedMinutesAgo,
        ],
      );
      observationCount += 1;
    }
    await connection.execute(
      `UPDATE identity_shadow_verification_batch
       SET status = 'COMPLETED', observation_count = ?,
           completed_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE)
       WHERE id = ?`,
      [observationCount, input.observedMinutesAgo, verificationBatchId],
    );
  }

  async function sourceMutationSequence(): Promise<number> {
    const [rows] = await connection.query<Array<RowDataPacket & { sequence: number | string }>>(
      "SELECT sequence FROM identity_source_mutation_watermark WHERE id = 1",
    );
    return Number(rows[0]?.sequence ?? -1);
  }

  async function insertRangeValidationGraph(actorUserId: number): Promise<{
    cycleId: number;
    otherCycleId: number;
    admissionId: number;
    fallbackAdmissionId: number;
    matchingAdmissionId: number;
    matchingSlotId: number;
    candidateId: number;
    candidateClaimId: number;
    secondaryCandidateId: number;
    secondaryCandidateClaimId: number;
    registrationId: number;
    secondaryRegistrationId: number;
    operationId: number;
    assignmentId: number;
    overlappingRangeId: number;
  }> {
    const cycleId = await insertId(
      `INSERT INTO exam_cycle
        (system_profile_id, cycle_code, display_name, academic_year, status, created_by)
       VALUES (1, 'TRANSITION-GATE-PRIMARY', 'Transition gate primary', 2098, 'ACTIVE', ?)`,
      [actorUserId],
    );
    const otherCycleId = await insertId(
      `INSERT INTO exam_cycle
        (system_profile_id, cycle_code, display_name, academic_year, status, created_by)
       VALUES (1, 'TRANSITION-GATE-OTHER', 'Transition gate other', 2099, 'DRAFT', ?)`,
      [actorUserId],
    );
    await connection.execute(
      `INSERT INTO number_uniqueness_policy
        (exam_cycle_id, examinee_scope, pseudonym_scope, updated_by)
       VALUES (?, 'SYSTEM', 'ADMISSION', ?)`,
      [cycleId, actorUserId],
    );
    const admissionId = await insertId(
      `INSERT INTO admission
        (exam_cycle_id, source_code, display_name, canonical_name, identity_key)
       VALUES (?, 'TRANSITION', 'Transition', 'TRANSITION', ?)`,
      [cycleId, syntheticDigest(1)],
    );
    const slotId = await insertId(
      `INSERT INTO operation_slot
        (admission_id, exam_date, start_time, period_name, period_canonical_name, identity_key)
       VALUES (?, '2098-01-01', '09:00:00', 'Period', 'PERIOD', ?)`,
      [admissionId, syntheticDigest(2)],
    );
    const segmentIds = [
      await insertId(
        `INSERT INTO schedule_segment
          (operation_slot_id, unit_name, major_name, building_name, room_name, identity_key)
         VALUES (?, 'Unit 1', 'Major', 'Building', 'Room 1', ?)`,
        [slotId, syntheticDigest(3)],
      ),
      await insertId(
        `INSERT INTO schedule_segment
          (operation_slot_id, unit_name, major_name, building_name, room_name, identity_key)
         VALUES (?, 'Unit 2', 'Major', 'Building', 'Room 2', ?)`,
        [slotId, syntheticDigest(4)],
      ),
    ];
    const fallbackAdmissionId = await insertId(
      `INSERT INTO admission
        (exam_cycle_id, source_code, display_name, canonical_name, identity_key)
       VALUES (?, 'TRANSITION-FALLBACK', 'Transition fallback', 'TRANSITION FALLBACK', ?)`,
      [cycleId, syntheticDigest(10)],
    );
    const fallbackSlotId = await insertId(
      `INSERT INTO operation_slot
        (admission_id, exam_date, start_time, period_name, period_canonical_name, identity_key)
       VALUES (?, '2098-01-02', '09:00:00', 'Fallback period', 'FALLBACK PERIOD', ?)`,
      [fallbackAdmissionId, syntheticDigest(11)],
    );
    const fallbackSegmentId = await insertId(
      `INSERT INTO schedule_segment
        (operation_slot_id, unit_name, major_name, building_name, room_name, identity_key)
       VALUES (?, 'Fallback unit', 'Major', 'Building', 'Room 3', ?)`,
      [fallbackSlotId, syntheticDigest(12)],
    );
    const matchingAdmissionId = await insertId(
      `INSERT INTO admission
        (exam_cycle_id, source_code, display_name, canonical_name, identity_key)
       VALUES (?, 'TRANSITION-MATCHING', 'Transition matching', 'TRANSITION MATCHING', ?)`,
      [cycleId, syntheticDigest(13)],
    );
    const matchingSlotId = await insertId(
      `INSERT INTO operation_slot
        (admission_id, exam_date, start_time, period_name, period_canonical_name, identity_key)
       VALUES (?, '2098-01-03', '09:00:00', 'Matching period', 'MATCHING PERIOD', ?)`,
      [matchingAdmissionId, syntheticDigest(14)],
    );
    const candidateIds = [
      await insertId(
        `INSERT INTO candidate
          (exam_cycle_id, examinee_no_display, examinee_no_canonical, name, birth_date, source_hash)
         VALUES (?, 'T-1', 'T-1', 'Synthetic 1', '2090-01-01', ?)`,
        [cycleId, syntheticDigest(5)],
      ),
      await insertId(
        `INSERT INTO candidate
          (exam_cycle_id, examinee_no_display, examinee_no_canonical, name, birth_date, source_hash)
         VALUES (?, 'T-2', 'T-2', 'Synthetic 2', '2090-01-02', ?)`,
        [cycleId, syntheticDigest(6)],
      ),
    ];
    const registrationIds: number[] = [];
    for (let index = 0; index < candidateIds.length; index += 1) {
      const registrationId = await insertId(
        `INSERT INTO candidate_registration
          (candidate_id, schedule_segment_id, source_hash)
         VALUES (?, ?, ?)`,
        [candidateIds[index], segmentIds[index], syntheticDigest(7 + index)],
      );
      await connection.execute(
        `INSERT INTO candidate_registration_slot_claim
          (registration_id, candidate_id, operation_slot_id)
         VALUES (?, ?, ?)`,
        [registrationId, candidateIds[index], slotId],
      );
      registrationIds.push(registrationId);
    }
    const candidateClaimId = await insertSystemCandidateClaim(candidateIds[0]!, cycleId, "T-1");
    const secondaryCandidateClaimId = await insertSystemCandidateClaim(candidateIds[1]!, cycleId, "T-2");
    const operationId = await insertId(`INSERT INTO pseudonym_operation_state (operation_slot_id) VALUES (?)`, [
      slotId,
    ]);
    const assignmentId = await insertId(
      `INSERT INTO candidate_pseudonym_assignment
        (registration_id, pseudonym_operation_id, pseudonym_value,
         assignment_mode, assigned_by)
       VALUES (?, ?, 1, 'MANUAL', ?)`,
      [registrationIds[0]!, operationId, actorUserId],
    );
    await insertPseudonymClaim(assignmentId, admissionId);
    await insertAssignmentEvent({
      assignmentId,
      registrationId: registrationIds[0]!,
      operationId,
      actorUserId,
    });
    const policyId = await insertId(
      `INSERT INTO pseudonym_policy
        (exam_cycle_id, scope_kind, admission_id, scope_key, updated_by)
       VALUES (?, 'ADMISSION', ?, ?, ?)`,
      [cycleId, admissionId, admissionPolicyScopeKey(admissionId), actorUserId],
    );
    await insertId(
      `INSERT INTO pseudonym_range
        (pseudonym_policy_id, schedule_segment_id, range_start_value,
         range_end_value, next_value, updated_by)
       VALUES (?, ?, 1, 1, 1, ?)`,
      [policyId, segmentIds[0], actorUserId],
    );
    const overlappingRangeId = await insertId(
      `INSERT INTO pseudonym_range
        (pseudonym_policy_id, schedule_segment_id, range_start_value,
         range_end_value, next_value, updated_by)
       VALUES (?, ?, 1, 2, 1, ?)`,
      [policyId, segmentIds[1], actorUserId],
    );
    const defaultPolicyId = await insertId(
      `INSERT INTO pseudonym_policy
        (exam_cycle_id, scope_kind, admission_id, scope_key, updated_by)
       VALUES (?, 'DEFAULT', NULL, ?, ?)`,
      [cycleId, defaultPolicyScopeKey(cycleId), actorUserId],
    );
    await insertId(
      `INSERT INTO pseudonym_policy
        (exam_cycle_id, scope_kind, admission_id, scope_key, assignment_method, updated_by)
       VALUES (?, 'ADMISSION', ?, ?, 'MATCHING', ?)`,
      [cycleId, matchingAdmissionId, admissionPolicyScopeKey(matchingAdmissionId), actorUserId],
    );
    for (const segmentId of segmentIds) {
      await insertId(
        `INSERT INTO pseudonym_range
          (pseudonym_policy_id, schedule_segment_id, range_start_value,
           range_end_value, next_value, updated_by)
         VALUES (?, ?, 1, 2, 1, ?)`,
        [defaultPolicyId, segmentId, actorUserId],
      );
    }
    await insertId(
      `INSERT INTO pseudonym_range
        (pseudonym_policy_id, schedule_segment_id, range_start_value,
         range_end_value, next_value, updated_by)
       VALUES (?, ?, 1, 1, 1, ?)`,
      [defaultPolicyId, fallbackSegmentId, actorUserId],
    );
    return {
      cycleId,
      otherCycleId,
      admissionId,
      fallbackAdmissionId,
      matchingAdmissionId,
      matchingSlotId,
      candidateId: candidateIds[0]!,
      candidateClaimId,
      secondaryCandidateId: candidateIds[1]!,
      secondaryCandidateClaimId,
      registrationId: registrationIds[0]!,
      secondaryRegistrationId: registrationIds[1]!,
      operationId,
      assignmentId,
      overlappingRangeId,
    };
  }

  async function insertSystemCandidateClaim(candidateId: number, cycleId: number, examineeNo: string): Promise<number> {
    return insertId(
      `INSERT INTO candidate_number_claim
        (candidate_id, registration_id, scope_kind, exam_cycle_id, operation_slot_id,
         scope_key, owner_key, examinee_no_canonical)
       VALUES (?, NULL, 'SYSTEM', ?, NULL, ?, ?, ?)`,
      [
        candidateId,
        cycleId,
        candidateSystemScopeKey(cycleId),
        candidateClaimOwnerKey({ scopeKind: "SYSTEM", candidateId }),
        examineeNo,
      ],
    );
  }

  async function insertPseudonymClaim(assignmentId: number, admissionId: number, pseudonymValue = 1): Promise<void> {
    await connection.execute(
      `INSERT INTO pseudonym_number_claim
        (assignment_id, scope_kind, admission_id, operation_slot_id, scope_key, pseudonym_value)
       VALUES (?, 'ADMISSION', ?, NULL, ?, ?)`,
      [assignmentId, admissionId, pseudonymAdmissionScopeKey(admissionId), pseudonymValue],
    );
  }

  async function insertAssignmentEvent(input: {
    assignmentId: number;
    registrationId: number;
    operationId: number;
    actorUserId: number;
    pseudonymValue?: number;
  }): Promise<void> {
    await connection.execute(
      `INSERT INTO pseudonym_assignment_event
        (assignment_id, registration_id, operation_id, event_type, pseudonym_value,
         display_width, assignment_mode, actor_user_id)
       VALUES (?, ?, ?, 'ASSIGNED', ?, 1, 'MANUAL', ?)`,
      [input.assignmentId, input.registrationId, input.operationId, input.pseudonymValue ?? 1, input.actorUserId],
    );
  }

  async function insertId(sql: string, parameters: readonly (Buffer | number | string)[]): Promise<number> {
    const [result] = await connection.execute<ResultSetHeader>(sql, [...parameters]);
    return Number(result.insertId);
  }

  function syntheticDigest(byte: number): Buffer {
    return Buffer.alloc(32, byte);
  }

  async function expectState(writeMode: string, readMode: string, phase: string, version: number): Promise<void> {
    const [rows] = await connection.query<
      Array<RowDataPacket & { writeMode: string; readMode: string; phase: string; version: number }>
    >(
      `SELECT write_mode AS writeMode, read_mode AS readMode, phase, version
       FROM identity_transition_state WHERE id = 1`,
    );
    expect(rows).toEqual([{ writeMode, readMode, phase, version }]);
  }
});
