import { createHash, randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdentityBackfillProjectionRepository } from "../src/database/identity-backfill-projection.repository.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

const expectedTargetTables = [
  "admission",
  "admission_identity_alias",
  "candidate",
  "candidate_identity_photo",
  "candidate_number_claim",
  "candidate_pseudonym_assignment",
  "candidate_registration",
  "candidate_registration_slot_claim",
  "exam_cycle",
  "identity_backfill_checkpoint",
  "identity_backfill_run",
  "identity_canary_admission",
  "identity_canary_user",
  "identity_migration_issue",
  "identity_shadow_observation",
  "identity_shadow_verification_batch",
  "identity_source_mutation_watermark",
  "identity_transition_state",
  "identity_transition_gate_evidence",
  "identity_transition_history_evidence",
  "identity_transition_request",
  "identity_transition_request_approval",
  "identity_transition_request_evidence",
  "identity_transition_state_history",
  "legacy_pseudonym_reservation",
  "number_uniqueness_policy",
  "operation_slot",
  "print_projection_snapshot",
  "print_job_reissue_event",
  "pseudonym_assignment_event",
  "pseudonym_number_claim",
  "pseudonym_operation_event",
  "pseudonym_operation_state",
  "pseudonym_policy",
  "pseudonym_range",
  "schedule_segment",
  "user_admission_scope_assignment",
] as const;

describe("target identity schema constraints on MariaDB", () => {
  let harness: MariaDbIntegrationHarness;

  beforeAll(async () => {
    harness = await createMariaDbIntegrationHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it("applies the target schema migrations and exposes every expand-only target table", async () => {
    const [migrationRows] = await harness.pool.query<Array<RowDataPacket & { version: string; status: string }>>(
      `SELECT version, status FROM schema_migration
       WHERE version >= '027_' AND version <= '037_zzzz'
       ORDER BY version`,
    );
    expect(migrationRows).toEqual([
      { version: "027_target_identity_core.sql", status: "APPLIED" },
      { version: "028_target_identity_policies.sql", status: "APPLIED" },
      { version: "029_target_identity_operations.sql", status: "APPLIED" },
      { version: "030_target_identity_account_scope.sql", status: "APPLIED" },
      { version: "031_target_identity_candidate_photo.sql", status: "APPLIED" },
      { version: "032_target_identity_print_template.sql", status: "APPLIED" },
      { version: "033_target_identity_transition_control.sql", status: "APPLIED" },
      { version: "034_target_identity_transition_gate.sql", status: "APPLIED" },
      { version: "035_print_job_reissue_history.sql", status: "APPLIED" },
      { version: "036_identity_shadow_verification_batch.sql", status: "APPLIED" },
      { version: "037_immutable_identity_history.sql", status: "APPLIED" },
    ]);

    const [tableRows] = await harness.pool.query<Array<RowDataPacket & { tableName: string }>>(
      `SELECT TABLE_NAME AS tableName
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()`,
    );
    const tableNames = new Set(tableRows.map((row) => row.tableName));
    for (const table of expectedTargetTables) expect(tableNames.has(table), `missing table ${table}`).toBe(true);
  });

  it("enforces the admission alias cycle and admission as one composite relationship", async () => {
    const first = await insertIdentityGraph("alias-first");
    const second = await insertIdentityGraph("alias-second");

    await expect(
      harness.pool.execute(
        `INSERT INTO admission_identity_alias
          (exam_cycle_id, admission_id, alias_type, alias_value, alias_key)
         VALUES (?, ?, 'NAME', 'cross-cycle alias', ?)`,
        [first.cycleId, second.admissionId, digest("cross-cycle-alias")],
      ),
    ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });

    await expect(
      harness.pool.execute(
        `INSERT INTO admission_identity_alias
          (exam_cycle_id, admission_id, alias_type, alias_value, alias_key)
         VALUES (?, ?, 'NAME', 'same-cycle alias', ?)`,
        [first.cycleId, first.admissionId, digest("same-cycle-alias")],
      ),
    ).resolves.toBeDefined();
  });

  it("treats the legacy candidate photo source as a one-to-one bridge", async () => {
    const graph = await insertIdentityGraph("photo-source");
    const secondCandidateId = await insertCandidate(graph.cycleId, "PHOTO-SECOND");
    const sourceCandidateRecordId = await insertLegacyCandidateRecord("PHOTO-SOURCE");

    await harness.pool.execute(
      `INSERT INTO candidate_identity_photo
        (candidate_id, source_candidate_record_id, file_name, mime_type, content, content_hash)
       VALUES (?, ?, 'first.png', 'image/png', ?, ?)`,
      [graph.candidateId, sourceCandidateRecordId, Buffer.from("first-photo"), "a".repeat(64)],
    );

    await expect(
      harness.pool.execute(
        `INSERT INTO candidate_identity_photo
          (candidate_id, source_candidate_record_id, file_name, mime_type, content, content_hash)
         VALUES (?, ?, 'second.png', 'image/png', ?, ?)`,
        [secondCandidateId, sourceCandidateRecordId, Buffer.from("second-photo"), "b".repeat(64)],
      ),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
  });

  it("blocks duplicate candidate occupancy and number claims in one operation slot", async () => {
    const graph = await insertIdentityGraph("candidate-claims");
    const secondSegmentId = await insertSegment(graph.slotId, "candidate-claims-second-segment");
    const secondRegistrationId = await insertRegistration(graph.candidateId, secondSegmentId);

    await harness.pool.execute(
      `INSERT INTO candidate_registration_slot_claim
        (registration_id, candidate_id, operation_slot_id)
       VALUES (?, ?, ?)`,
      [graph.registrationId, graph.candidateId, graph.slotId],
    );
    await expect(
      harness.pool.execute(
        `INSERT INTO candidate_registration_slot_claim
          (registration_id, candidate_id, operation_slot_id)
         VALUES (?, ?, ?)`,
        [secondRegistrationId, graph.candidateId, graph.slotId],
      ),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });

    const secondCandidateId = await insertCandidate(graph.cycleId, "CLAIM-SECOND");
    const scopeKey = digest("candidate-claim-scope");
    await harness.pool.execute(
      `INSERT INTO candidate_number_claim
        (candidate_id, registration_id, scope_kind, exam_cycle_id, operation_slot_id,
         scope_key, owner_key, examinee_no_canonical)
       VALUES (?, NULL, 'SYSTEM', ?, NULL, ?, ?, 'SHARED-NUMBER')`,
      [graph.candidateId, graph.cycleId, scopeKey, digest("candidate-owner-one")],
    );
    await expect(
      harness.pool.execute(
        `INSERT INTO candidate_number_claim
          (candidate_id, registration_id, scope_kind, exam_cycle_id, operation_slot_id,
           scope_key, owner_key, examinee_no_canonical)
         VALUES (?, NULL, 'SYSTEM', ?, NULL, ?, ?, 'SHARED-NUMBER')`,
        [secondCandidateId, graph.cycleId, scopeKey, digest("candidate-owner-two")],
      ),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
  });

  it("keeps assignment history while releasing the current number claim", async () => {
    const graph = await insertIdentityGraph("assignment-history");
    const operationId = await insertOperationState(graph.slotId);
    const assignmentId = await insertAssignment(graph.registrationId, operationId, graph.userId, 7001);

    await harness.pool.execute(
      `INSERT INTO pseudonym_number_claim
        (assignment_id, scope_kind, admission_id, operation_slot_id, scope_key, pseudonym_value)
       VALUES (?, 'ADMISSION', ?, NULL, ?, 7001)`,
      [assignmentId, graph.admissionId, digest("assignment-admission-scope")],
    );
    const [eventResult] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO pseudonym_assignment_event
        (assignment_id, registration_id, operation_id, event_type, pseudonym_value,
         display_width, assignment_mode, actor_user_id)
       VALUES (?, ?, ?, 'ASSIGNED', 7001, 4, 'MANUAL', ?)`,
      [assignmentId, graph.registrationId, operationId, graph.userId],
    );

    await harness.pool.execute("DELETE FROM candidate_pseudonym_assignment WHERE id = ?", [assignmentId]);

    const [eventRows] = await harness.pool.execute<Array<RowDataPacket & { assignmentId: number | null }>>(
      `SELECT assignment_id AS assignmentId FROM pseudonym_assignment_event WHERE id = ?`,
      [eventResult.insertId],
    );
    expect(eventRows).toEqual([{ assignmentId: null }]);

    const [claimRows] = await harness.pool.execute<Array<RowDataPacket & { claimCount: number }>>(
      "SELECT COUNT(*) AS claimCount FROM pseudonym_number_claim WHERE assignment_id = ?",
      [assignmentId],
    );
    expect(Number(claimRows[0]?.claimCount)).toBe(0);
  });

  it("releases only the mutable print assignment bridge when its current assignment is removed", async () => {
    const [rules] = await harness.pool.execute<Array<RowDataPacket & { deleteRule: string }>>(
      `SELECT DELETE_RULE AS deleteRule
       FROM information_schema.REFERENTIAL_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE()
         AND TABLE_NAME = 'print_job'
         AND CONSTRAINT_NAME = 'fk_print_job_canonical_assignment'`,
    );
    expect(rules).toEqual([{ deleteRule: "SET NULL" }]);
  });

  it("enforces target CHECK constraints and the transition singleton", async () => {
    const graph = await insertIdentityGraph("check-constraints");

    await expect(
      harness.pool.execute(
        `INSERT INTO pseudonym_policy
          (exam_cycle_id, scope_kind, admission_id, scope_key, assignment_method)
         VALUES (?, 'DEFAULT', ?, ?, 'DRAW')`,
        [graph.cycleId, graph.admissionId, digest("invalid-default-policy")],
      ),
    ).rejects.toThrow("ck_pseudonym_policy_scope");

    await expect(
      harness.pool.execute(
        `INSERT INTO candidate_registration
          (candidate_id, schedule_segment_id, preassigned_value, preassigned_display_width, source_hash)
         VALUES (?, ?, 1, NULL, ?)`,
        [
          graph.candidateId,
          await insertSegment(graph.slotId, "invalid-preassigned-segment"),
          digest("invalid-registration"),
        ],
      ),
    ).rejects.toThrow("ck_candidate_registration_preassigned");

    const [policyResult] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO pseudonym_policy
        (exam_cycle_id, scope_kind, admission_id, scope_key, assignment_method)
       VALUES (?, 'ADMISSION', ?, ?, 'DRAW')`,
      [graph.cycleId, graph.admissionId, digest("display-width-policy")],
    );
    await expect(
      harness.pool.execute(
        `INSERT INTO pseudonym_range
          (pseudonym_policy_id, schedule_segment_id, range_start_value,
           range_end_value, next_value, display_width)
         VALUES (?, ?, 1, 1, 1, 101)`,
        [policyResult.insertId, graph.segmentId],
      ),
    ).rejects.toThrow("ck_pseudonym_range_values");

    const operationId = await insertOperationState(graph.slotId);
    await expect(
      harness.pool.execute(
        `INSERT INTO candidate_pseudonym_assignment
          (registration_id, pseudonym_operation_id, pseudonym_value, display_width,
           assignment_mode, assigned_by)
         VALUES (?, ?, 1, 101, 'MANUAL', ?)`,
        [graph.registrationId, operationId, graph.userId],
      ),
    ).rejects.toThrow("ck_candidate_pseudonym_assignment_value");
    await expect(
      harness.pool.execute(
        `INSERT INTO pseudonym_assignment_event
          (registration_id, operation_id, event_type, pseudonym_value,
           display_width, assignment_mode, actor_user_id)
         VALUES (?, ?, 'ASSIGNED', 1, 101, 'MANUAL', ?)`,
        [graph.registrationId, operationId, graph.userId],
      ),
    ).rejects.toThrow("ck_pseudonym_assignment_event_value");

    await expect(
      harness.pool.execute(
        `INSERT INTO identity_transition_state (id, write_mode, read_mode, phase)
         VALUES (2, 'LEGACY', 'LEGACY', 'EXPANDED')`,
      ),
    ).rejects.toThrow("ck_identity_transition_singleton");
  });

  it("keeps one directly editable row for each form template code", async () => {
    const graph = await insertIdentityGraph("template-editing");
    const templateCode = `EDITABLE_TEMPLATE_${randomUUID()}`;
    const [templateResult] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO form_template
        (code, name, description, category, usage_scope, layout_json, active, created_by)
       VALUES (?, 'Editable fixture', NULL, 'fixture', 'CANDIDATE',
               JSON_OBJECT('pages', JSON_ARRAY()), TRUE, ?)`,
      [templateCode, graph.userId],
    );

    await expect(
      harness.pool.execute("UPDATE form_template SET name = 'Edited', active = FALSE WHERE id = ?", [
        templateResult.insertId,
      ]),
    ).resolves.toBeDefined();
    await expect(
      harness.pool.execute(
        `INSERT INTO form_template
          (code, name, description, category, usage_scope, layout_json, active, created_by)
         VALUES (?, 'Duplicate fixture', NULL, 'fixture', 'CANDIDATE', JSON_OBJECT(), TRUE, ?)`,
        [templateCode, graph.userId],
      ),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
  });

  it("keeps assignment operations, legacy reservations, and print snapshots append-only", async () => {
    const graph = await insertIdentityGraph("append-only-history");
    const operationId = await insertOperationState(graph.slotId);
    const [operationEvent] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO pseudonym_operation_event
        (operation_id, event_type, actor_user_id)
       VALUES (?, 'CLOSED', ?)`,
      [operationId, graph.userId],
    );
    await expect(
      harness.pool.execute("UPDATE pseudonym_operation_event SET event_type = 'REOPENED' WHERE id = ?", [
        operationEvent.insertId,
      ]),
    ).rejects.toMatchObject({ code: "ER_SIGNAL_EXCEPTION" });
    await expect(
      harness.pool.execute("DELETE FROM pseudonym_operation_event WHERE id = ?", [operationEvent.insertId]),
    ).rejects.toMatchObject({ code: "ER_SIGNAL_EXCEPTION" });

    const assignmentId = await insertAssignment(graph.registrationId, operationId, graph.userId, 8801);
    const [assignmentEvent] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO pseudonym_assignment_event
        (assignment_id, registration_id, operation_id, event_type, pseudonym_value,
         display_width, assignment_mode, actor_user_id)
       VALUES (?, ?, ?, 'ASSIGNED', 8801, 4, 'MANUAL', ?)`,
      [assignmentId, graph.registrationId, operationId, graph.userId],
    );
    await expect(
      harness.pool.execute("UPDATE pseudonym_assignment_event SET pseudonym_value = 8802 WHERE id = ?", [
        assignmentEvent.insertId,
      ]),
    ).rejects.toMatchObject({ code: "ER_SIGNAL_EXCEPTION" });
    await expect(
      harness.pool.execute("DELETE FROM pseudonym_assignment_event WHERE id = ?", [assignmentEvent.insertId]),
    ).rejects.toMatchObject({ code: "ER_SIGNAL_EXCEPTION" });

    const legacyExamName = `Immutable legacy ${randomUUID()}`;
    const legacyExamineeNo = `IMMUTABLE-${randomUUID()}`;
    const [legacyExaminee] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO examinee
        (examinee_no, name, exam_name, exam_date, room_name, seat_no, label_barcode)
       VALUES (?, 'Immutable legacy fixture', ?, '2042-09-01', 'Legacy room', '00', ?)`,
      [legacyExamineeNo, legacyExamName, `IT-${randomUUID()}`],
    );
    const [legacyAssignment] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO pseudonym_assignment
        (examinee_id, candidate_record_id, exam_name, admission_name,
         uniqueness_scope_key, pseudonym_no, assignment_mode, assigned_by)
       VALUES (?, NULL, ?, 'Immutable legacy admission', ?, '9901', 'MANUAL', ?)`,
      [
        legacyExaminee.insertId,
        legacyExamName,
        digest(`legacy-assignment:${randomUUID()}`).toString("hex"),
        graph.userId,
      ],
    );
    const [reservation] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO legacy_pseudonym_reservation
        (exam_cycle_id, admission_id, source_assignment_id, scope_key, pseudonym_value, reason_code)
       VALUES (?, ?, ?, ?, 9901, 'UNMAPPED_SCHEDULE')`,
      [graph.cycleId, graph.admissionId, legacyAssignment.insertId, digest(`legacy-reservation:${randomUUID()}`)],
    );
    await expect(
      harness.pool.execute("UPDATE legacy_pseudonym_reservation SET pseudonym_value = 9902 WHERE id = ?", [
        reservation.insertId,
      ]),
    ).rejects.toMatchObject({ code: "ER_SIGNAL_EXCEPTION" });
    await expect(
      harness.pool.execute("DELETE FROM legacy_pseudonym_reservation WHERE id = ?", [reservation.insertId]),
    ).rejects.toMatchObject({ code: "ER_SIGNAL_EXCEPTION" });

    const [printDependencies] = await harness.pool.query<
      Array<RowDataPacket & { workstationId: number; templateId: number }>
    >(
      `SELECT workstation.id AS workstationId, template.id AS templateId
       FROM workstation
       INNER JOIN label_template template ON template.active = TRUE
       WHERE workstation.enabled = TRUE
       ORDER BY workstation.id, template.id LIMIT 1`,
    );
    const printDependency = printDependencies[0];
    if (!printDependency) throw new Error("Print dependencies are missing.");
    const printJobId = randomUUID();
    await harness.pool.execute(
      `INSERT INTO print_job
        (id, job_no, label_type, business_ref, template_id, template_version, workstation_id,
         requested_by, idempotency_key, request_fingerprint, copies, status, expires_at)
       VALUES (?, ?, 'PSEUDONYM_LABEL', 'immutable-snapshot-fixture', ?, 1, ?, ?, ?, ?, 1, 'SENT', NOW(3))`,
      [
        printJobId,
        `PJ-IMMUTABLE-${randomUUID()}`,
        printDependency.templateId,
        printDependency.workstationId,
        graph.userId,
        randomUUID(),
        "f".repeat(64),
      ],
    );
    await harness.pool.execute(
      "INSERT INTO print_job_payload (print_job_id, format, payload) VALUES (?, 'ZPL', '^XA^FDORIGINAL^FS^XZ')",
      [printJobId],
    );
    const projection = new IdentityBackfillProjectionRepository();
    await projection.syncPrintSnapshot(harness.pool, printJobId);
    const [originalSnapshots] = await harness.pool.execute<
      Array<RowDataPacket & { projectionJson: string | Record<string, unknown>; projectionDigest: string }>
    >(
      `SELECT projection_json AS projectionJson, projection_digest AS projectionDigest
       FROM print_projection_snapshot WHERE print_job_id = ?`,
      [printJobId],
    );
    expect(originalSnapshots).toHaveLength(1);
    await harness.pool.execute("UPDATE print_job SET job_no = ?, copies = 2 WHERE id = ?", [
      `PJ-MUTATED-${randomUUID()}`,
      printJobId,
    ]);
    await harness.pool.execute("UPDATE print_job_payload SET payload = '^XA^FDMUTATED^FS^XZ' WHERE print_job_id = ?", [
      printJobId,
    ]);
    await projection.syncPrintSnapshot(harness.pool, printJobId);
    const [replayedSnapshots] = await harness.pool.execute<
      Array<RowDataPacket & { projectionJson: string | Record<string, unknown>; projectionDigest: string }>
    >(
      `SELECT projection_json AS projectionJson, projection_digest AS projectionDigest
       FROM print_projection_snapshot WHERE print_job_id = ?`,
      [printJobId],
    );
    expect(replayedSnapshots).toEqual(originalSnapshots);
    await expect(
      harness.pool.execute(
        "UPDATE print_projection_snapshot SET projection_json = JSON_OBJECT('projectionVersion', 2) WHERE print_job_id = ?",
        [printJobId],
      ),
    ).rejects.toMatchObject({ code: "ER_SIGNAL_EXCEPTION" });
    await expect(
      harness.pool.execute("DELETE FROM print_projection_snapshot WHERE print_job_id = ?", [printJobId]),
    ).rejects.toMatchObject({ code: "ER_SIGNAL_EXCEPTION" });
  });

  async function insertIdentityGraph(seed: string) {
    const [userRows] = await harness.pool.query<Array<RowDataPacket & { id: number }>>(
      "SELECT id FROM app_user WHERE login_id = 'system' LIMIT 1",
    );
    const userId = Number(userRows[0]?.id);
    if (!userId) throw new Error("System user fixture is missing.");

    const [cycleResult] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO exam_cycle
        (system_profile_id, cycle_code, display_name, academic_year, status, created_by, updated_by)
       VALUES (1, ?, ?, 2042, 'ACTIVE', ?, ?)`,
      [`IT:${seed}:${randomUUID()}`, `Integration ${seed}`, userId, userId],
    );
    const cycleId = Number(cycleResult.insertId);
    const [admissionResult] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO admission
        (exam_cycle_id, source_code, display_name, canonical_name, identity_key)
       VALUES (?, NULL, ?, ?, ?)`,
      [cycleId, `Admission ${seed}`, `ADMISSION ${seed}`, digest(`admission:${seed}`)],
    );
    const admissionId = Number(admissionResult.insertId);
    const [slotResult] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO operation_slot
        (admission_id, exam_date, start_time, end_time, period_code, period_name,
         period_canonical_name, identity_key)
       VALUES (?, '2042-09-01', '09:00:00', '10:00:00', NULL, ?, ?, ?)`,
      [admissionId, `Period ${seed}`, `PERIOD ${seed}`, digest(`slot:${seed}`)],
    );
    const slotId = Number(slotResult.insertId);
    const segmentId = await insertSegment(slotId, `${seed}-segment`);
    const candidateId = await insertCandidate(cycleId, `CANDIDATE-${seed}-${randomUUID()}`);
    const registrationId = await insertRegistration(candidateId, segmentId);
    return { userId, cycleId, admissionId, slotId, segmentId, candidateId, registrationId };
  }

  async function insertSegment(slotId: number, seed: string) {
    const [result] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO schedule_segment
        (operation_slot_id, unit_name, major_name, building_name, room_name, identity_key)
       VALUES (?, 'Unit', '', 'Building', ?, ?)`,
      [slotId, `Room ${seed}`, digest(`segment:${seed}`)],
    );
    return Number(result.insertId);
  }

  async function insertCandidate(cycleId: number, examineeNo: string) {
    const [result] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO candidate
        (exam_cycle_id, examinee_no_display, examinee_no_canonical, name, birth_date, source_hash)
       VALUES (?, ?, ?, 'Synthetic candidate', '2000-01-01', ?)`,
      [cycleId, examineeNo, examineeNo, digest(`candidate:${examineeNo}`)],
    );
    return Number(result.insertId);
  }

  async function insertRegistration(candidateId: number, segmentId: number) {
    const [result] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO candidate_registration
        (candidate_id, schedule_segment_id, source_hash)
       VALUES (?, ?, ?)`,
      [candidateId, segmentId, digest(`registration:${candidateId}:${segmentId}`)],
    );
    return Number(result.insertId);
  }

  async function insertOperationState(slotId: number) {
    const [result] = await harness.pool.execute<ResultSetHeader>(
      "INSERT INTO pseudonym_operation_state (operation_slot_id, state) VALUES (?, 'OPEN')",
      [slotId],
    );
    return Number(result.insertId);
  }

  async function insertAssignment(registrationId: number, operationId: number, userId: number, value: number) {
    const [result] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO candidate_pseudonym_assignment
        (registration_id, pseudonym_operation_id, pseudonym_value, display_width,
         assignment_mode, assigned_by)
       VALUES (?, ?, ?, 4, 'MANUAL', ?)`,
      [registrationId, operationId, value, userId],
    );
    return Number(result.insertId);
  }

  async function insertLegacyCandidateRecord(examineeNo: string) {
    const [result] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO candidate_record
        (admission, unit_name, exam_date, start_time, period_name, building_name, room_name,
         examinee_no, name, birth_date)
       VALUES ('Legacy admission', 'Legacy unit', '2042-09-01', '09:00', 'Legacy period',
               'Legacy building', 'Legacy room', ?, 'Legacy candidate', '2000-01-01')`,
      [examineeNo],
    );
    return Number(result.insertId);
  }
});

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
