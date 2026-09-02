import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveAppConfig } from "../src/config/app-config.js";
import { loadMigrationFiles, runMigrations } from "../src/database/migration-runner.js";
import { IdentityTransitionCoordinator } from "../src/identity-transition/identity-transition-coordinator.js";
import { IdentityTransitionStateRepository } from "../src/identity-transition/identity-transition-state.js";
import { PrintJobsService } from "../src/print-jobs/print-jobs.service.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = resolve(apiRoot, "src/database/migrations");
const previousMigration = "026_expand_audit_request_id.sql";
const targetIdentityMigrations = [
  "027_target_identity_core.sql",
  "028_target_identity_policies.sql",
  "029_target_identity_operations.sql",
  "030_target_identity_account_scope.sql",
  "031_target_identity_candidate_photo.sql",
  "032_target_identity_print_template.sql",
  "033_target_identity_transition_control.sql",
  "034_target_identity_transition_gate.sql",
  "035_print_job_reissue_history.sql",
  "036_identity_shadow_verification_batch.sql",
  "037_immutable_identity_history.sql",
  "038_form_template_deletion.sql",
  "039_remove_form_template_versioning.sql",
] as const;

describe("026 to current schema migration upgrade", () => {
  let harness: MariaDbIntegrationHarness;
  const printJobId = "00000000-0000-4000-8000-000000000033";
  let inactiveTemplateId = 0;
  let systemUserId = 0;
  let workstationCode = "";

  beforeAll(async () => {
    harness = await createMariaDbIntegrationHarness({ migrateThrough: previousMigration });

    const [identityRows] = await harness.pool.execute<
      Array<RowDataPacket & { userId: number; workstationId: number; workstationCode: string; templateId: number }>
    >(
      `SELECT u.id AS userId, w.id AS workstationId, w.code AS workstationCode, lt.id AS templateId
       FROM app_user u
       INNER JOIN workstation w ON w.code = 'WS-DEV-001'
       INNER JOIN label_template lt ON lt.code = 'PRINTER_TEST'
       WHERE u.login_id = 'system' LIMIT 1`,
    );
    const identity = identityRows[0];
    if (!identity) throw new Error("026 fixture identity rows were not created.");
    systemUserId = Number(identity.userId);
    workstationCode = identity.workstationCode;

    await harness.pool.execute(
      `INSERT INTO print_job
        (id, job_no, label_type, business_ref, template_id, template_version, workstation_id,
         requested_by, idempotency_key, request_fingerprint, copies, status, expires_at)
       VALUES (?, 'TARGET-IDENTITY-UPGRADE-033', 'PSEUDONYM_LABEL', 'legacy-fixture', ?, 1, ?, ?,
               '00000000-0000-4000-8000-000000000026', REPEAT('a', 64), 1, 'READY',
               DATE_ADD(NOW(3), INTERVAL 1 HOUR))`,
      [printJobId, identity.templateId, identity.workstationId, identity.userId],
    );
    const [templateResult] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO form_template
        (code, version, name, description, category, usage_scope, layout_json, active, created_by)
       VALUES ('IDENTITY_UPGRADE_ARCHIVED', 1, 'Archived fixture', NULL, 'fixture', 'CANDIDATE',
               JSON_OBJECT('pages', JSON_ARRAY()), FALSE, ?)`,
      [identity.userId],
    );
    inactiveTemplateId = Number(templateResult.insertId);

    const [examineeResult] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO examinee
        (examinee_no, name, exam_name, exam_date, room_name, seat_no, label_barcode, status)
       VALUES ('UPGRADE-026', '026 호환', '026 호환 시험', '2026-08-28', '026호', '26', 'UPGRADE026', 'ACTIVE')`,
    );
    const [candidateResult] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO candidate_record
        (admission, unit_name, exam_date, start_time, period_name, building_name, room_name,
         examinee_no, name, birth_date)
       VALUES ('026 전형', '026 모집단위', '2026-08-28', '09:00', '1교시', '026관', '026호',
               'UPGRADE-026', '026 호환', '2000-01-01')`,
    );
    await harness.pool.execute(
      `INSERT INTO pseudonym_assignment
        (examinee_id, candidate_record_id, exam_name, admission_name, uniqueness_scope_key,
         pseudonym_no, assignment_mode, assigned_by)
       VALUES (?, ?, '026 호환 시험', '026 전형', '', '9026', 'MANUAL', ?)`,
      [examineeResult.insertId, candidateResult.insertId, identity.userId],
    );
    await harness.pool.execute(
      `INSERT INTO pseudonym_setting
        (exam_name, admission_name, range_start, range_end, next_sequence,
         assignment_method, print_preassigned_label, updated_by)
       VALUES ('026 호환 시험', '026 전형', 9026, 9026, 9026, 'PREASSIGNED', TRUE, ?)`,
      [identity.userId],
    );
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it("keeps create and complete operational on a 026 database when transition support is disabled", async () => {
    const config = resolveAppConfig({ PRINT_JOB_EXPIRY_SECONDS: "300", IDENTITY_TRANSITION_ENABLED: "false" });
    const service = new PrintJobsService(
      harness.pool,
      config,
      undefined,
      undefined,
      undefined,
      new IdentityTransitionCoordinator(new IdentityTransitionStateRepository(config)),
    );
    const user = { id: systemUserId, loginId: "system", role: "ADMIN" as const, admissionNames: [] };
    const created = await service.create(
      {
        idempotencyKey: randomUUID(),
        examineeNo: "UPGRADE-026",
        workstationCode,
        copies: 1,
        examDate: "2026-08-28",
        examTime: "09:00",
        periodName: "1교시",
        admissionName: "026 전형",
      },
      user,
    );

    await expect(service.complete(created.id, { status: "SENT" }, user)).resolves.toEqual({
      id: created.id,
      status: "SENT",
    });
    const [targetTables] = await harness.pool.execute<Array<RowDataPacket & { tableCount: number }>>(
      `SELECT COUNT(*) AS tableCount FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN ('identity_transition_state', 'print_projection_snapshot')`,
    );
    expect(Number(targetTables[0]?.tableCount)).toBe(0);
  });

  it("preserves 026 data while applying every later migration", async () => {
    const migrations = await loadMigrationFiles(migrationsDirectory);
    const connection = await harness.pool.getConnection();
    try {
      const upgrade = await runMigrations(connection, migrations);
      expect(upgrade.applied).toEqual(targetIdentityMigrations);
      expect(upgrade.verified).toHaveLength(migrations.length - targetIdentityMigrations.length);

      const verification = await runMigrations(connection, migrations);
      expect(verification.applied).toEqual([]);
      expect(verification.verified).toHaveLength(migrations.length);
    } finally {
      connection.release();
    }

    const [printRows] = await harness.pool.execute<
      Array<
        RowDataPacket & {
          id: string;
          jobNo: string;
          candidateRegistrationId: number | null;
          canonicalAssignmentId: number | null;
          operationSlotId: number | null;
        }
      >
    >(
      `SELECT id, job_no AS jobNo, candidate_registration_id AS candidateRegistrationId,
              canonical_assignment_id AS canonicalAssignmentId, operation_slot_id AS operationSlotId
       FROM print_job WHERE id = ?`,
      [printJobId],
    );
    expect(printRows).toEqual([
      {
        id: printJobId,
        jobNo: "TARGET-IDENTITY-UPGRADE-033",
        candidateRegistrationId: null,
        canonicalAssignmentId: null,
        operationSlotId: null,
      },
    ]);

    const [reissueHistoryTables] = await harness.pool.execute<Array<RowDataPacket & { tableCount: number }>>(
      `SELECT COUNT(*) AS tableCount FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'print_job_reissue_event'`,
    );
    expect(Number(reissueHistoryTables[0]?.tableCount)).toBe(1);

    const [templateRows] = await harness.pool.execute<Array<RowDataPacket & { active: number; name: string }>>(
      `SELECT active, name FROM form_template WHERE id = ?`,
      [inactiveTemplateId],
    );
    expect(templateRows).toEqual([{ active: 0, name: "Archived fixture" }]);
    await expect(
      harness.pool.execute("UPDATE form_template SET name = 'mutated archived fixture' WHERE id = ?", [
        inactiveTemplateId,
      ]),
    ).resolves.toBeDefined();

    const [activeTemplateRows] = await harness.pool.execute<Array<RowDataPacket & { activeCount: number }>>(
      `SELECT COUNT(*) AS activeCount FROM form_template WHERE active = TRUE`,
    );
    expect(Number(activeTemplateRows[0]?.activeCount)).toBe(2);

    const [removedColumns] = await harness.pool.execute<Array<RowDataPacket & { columnCount: number }>>(
      `SELECT COUNT(*) AS columnCount
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'form_template'
         AND COLUMN_NAME IN ('version', 'lifecycle_state', 'published_by', 'published_at', 'supersedes_id')`,
    );
    expect(Number(removedColumns[0]?.columnCount)).toBe(0);

    const [transitionRows] = await harness.pool.execute<
      Array<RowDataPacket & { writeMode: string; readMode: string; phase: string; version: number }>
    >(
      `SELECT write_mode AS writeMode, read_mode AS readMode, phase, version
       FROM identity_transition_state WHERE id = 1`,
    );
    expect(transitionRows).toEqual([{ writeMode: "LEGACY", readMode: "LEGACY", phase: "EXPANDED", version: 1 }]);

    const [targetCounts] = await harness.pool.query<
      Array<RowDataPacket & { examCycles: number; admissions: number; candidates: number; registrations: number }>
    >(
      `SELECT (SELECT COUNT(*) FROM exam_cycle) AS examCycles,
              (SELECT COUNT(*) FROM admission) AS admissions,
              (SELECT COUNT(*) FROM candidate) AS candidates,
              (SELECT COUNT(*) FROM candidate_registration) AS registrations`,
    );
    expect(targetCounts).toEqual([{ examCycles: 0, admissions: 0, candidates: 0, registrations: 0 }]);
  });
});
