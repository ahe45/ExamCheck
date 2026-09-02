import { randomUUID } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../src/auth/auth.types.js";
import { CandidateIdentityRepository } from "../src/candidates/candidate-identity.repository.js";
import { resolveAppConfig } from "../src/config/app-config.js";
import { IdentityBackfillProjectionRepository } from "../src/database/identity-backfill-projection.repository.js";
import { IdentityTransitionCoordinator } from "../src/identity-transition/identity-transition-coordinator.js";
import { IdentityTransitionStateRepository } from "../src/identity-transition/identity-transition-state.js";
import type { CreatePrintJobDto } from "../src/print-jobs/print-jobs.dto.js";
import { PrintJobsService } from "../src/print-jobs/print-jobs.service.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

const schedule = {
  examName: "출력 통합 시험",
  examDate: "2038-05-17",
  examTime: "09:00",
  periodName: "출력 통합 1교시",
  admissionName: "출력 통합 전형",
};

let harness: MariaDbIntegrationHarness;
let service: PrintJobsService;
let owner: AuthenticatedUser;
let secondOwner: AuthenticatedUser;
let sourceCandidateRecordId: number;
let sourceAssignmentId: number;

beforeAll(async () => {
  harness = await createMariaDbIntegrationHarness();
  owner = await readSystemUser(harness.pool);
  secondOwner = await createSecondAdmin(harness.pool);
  const source = await seedPrintableCandidate(harness.pool, owner.id);
  sourceCandidateRecordId = source.sourceCandidateRecordId;
  sourceAssignmentId = source.sourceAssignmentId;
  await seedCanonicalPrintIdentity(harness.pool, source);
  const config = resolveAppConfig({
    PRINT_JOB_EXPIRY_SECONDS: "300",
    IDENTITY_TRANSITION_ENABLED: "true",
  });
  await harness.pool.execute("UPDATE identity_transition_state SET write_mode = 'DUAL' WHERE id = 1");
  service = new PrintJobsService(
    harness.pool,
    config,
    undefined,
    undefined,
    new IdentityBackfillProjectionRepository(),
    new IdentityTransitionCoordinator(new IdentityTransitionStateRepository(config)),
  );
});

afterAll(async () => {
  if (harness) await harness.cleanup();
});

describe("print job MariaDB integration", () => {
  it("applies idempotency, request-fingerprint and append-only reissue history on a fresh database", async () => {
    const [columns] = await harness.pool.execute<Array<RowDataPacket & { nullable: string; columnType: string }>>(
      `SELECT IS_NULLABLE AS nullable, COLUMN_TYPE AS columnType
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'print_job' AND COLUMN_NAME = 'idempotency_key'`,
    );
    expect(columns).toEqual([{ nullable: "YES", columnType: "char(36)" }]);

    const [indexes] = await harness.pool.execute<Array<RowDataPacket & { nonUnique: number; columns: string }>>(
      `SELECT NON_UNIQUE AS nonUnique,
              GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS columns
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'print_job'
         AND INDEX_NAME = 'uq_print_job_request_idempotency'
       GROUP BY NON_UNIQUE, INDEX_NAME`,
    );
    expect(indexes).toEqual([{ nonUnique: 0, columns: "requested_by,idempotency_key" }]);

    const [fingerprintColumns] = await harness.pool.execute<
      Array<RowDataPacket & { nullable: string; columnType: string; characterSet: string; collationName: string }>
    >(
      `SELECT IS_NULLABLE AS nullable, COLUMN_TYPE AS columnType,
              CHARACTER_SET_NAME AS characterSet, COLLATION_NAME AS collationName
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'print_job' AND COLUMN_NAME = 'request_fingerprint'`,
    );
    expect(fingerprintColumns).toEqual([
      { nullable: "YES", columnType: "char(64)", characterSet: "ascii", collationName: "ascii_bin" },
    ]);

    const [historyColumns] = await harness.pool.execute<
      Array<RowDataPacket & { columnName: string; nullable: string; columnType: string; characterSet: string | null }>
    >(
      `SELECT COLUMN_NAME AS columnName, IS_NULLABLE AS nullable, COLUMN_TYPE AS columnType,
              CHARACTER_SET_NAME AS characterSet
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'print_job_reissue_event'
         AND COLUMN_NAME IN ('reissue_type', 'reason_code')
       ORDER BY ORDINAL_POSITION`,
    );
    expect(historyColumns).toEqual([
      { columnName: "reissue_type", nullable: "NO", columnType: "enum('RETRY','REPRINT')", characterSet: "utf8mb4" },
      { columnName: "reason_code", nullable: "NO", columnType: "varchar(100)", characterSet: "ascii" },
    ]);

    const [historyTriggers] = await harness.pool.execute<Array<RowDataPacket & { triggerName: string }>>(
      `SELECT TRIGGER_NAME AS triggerName FROM INFORMATION_SCHEMA.TRIGGERS
       WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'print_job_reissue_event'
       ORDER BY TRIGGER_NAME`,
    );
    expect(historyTriggers).toEqual([
      { triggerName: "trg_print_job_reissue_event_no_delete" },
      { triggerName: "trg_print_job_reissue_event_no_update" },
    ]);
  });

  it("rejects direct API printing when the admission setting disables label output", async () => {
    await harness.pool.execute(
      "UPDATE pseudonym_setting SET print_preassigned_label = FALSE WHERE exam_name = ? AND admission_name = ?",
      [schedule.examName, schedule.admissionName],
    );
    try {
      await expect(service.create(createInput(randomUUID()), owner)).rejects.toThrow(
        "사전부여 방식에서 라벨 출력 사용이 설정된 전형만 라벨을 출력할 수 있습니다.",
      );
    } finally {
      await harness.pool.execute(
        "UPDATE pseudonym_setting SET print_preassigned_label = TRUE WHERE exam_name = ? AND admission_name = ?",
        [schedule.examName, schedule.admissionName],
      );
    }
  });

  it("returns one original job and payload for concurrent retries by the same user", async () => {
    const key = randomUUID();
    const [first, retried] = await Promise.all([
      service.create(createInput(key), owner),
      service.create(createInput(key), owner),
    ]);

    expect(retried).toEqual(first);
    expect(first.payload).toContain("^XA");
    const [counts] = await harness.pool.execute<
      Array<RowDataPacket & { jobs: number; payloads: number; snapshots: number; audits: number; auditDetails: string }>
    >(
      `SELECT
         (SELECT COUNT(*) FROM print_job WHERE requested_by = ? AND idempotency_key = ?) AS jobs,
         (SELECT COUNT(*) FROM print_job_payload pjp INNER JOIN print_job pj ON pj.id = pjp.print_job_id
           WHERE pj.requested_by = ? AND pj.idempotency_key = ?) AS payloads,
         (SELECT COUNT(*) FROM print_projection_snapshot snapshot
           INNER JOIN print_job pj ON pj.id = snapshot.print_job_id
           WHERE pj.requested_by = ? AND pj.idempotency_key = ?) AS snapshots,
         (SELECT COUNT(*) FROM audit_log al INNER JOIN print_job pj ON pj.id = al.print_job_id
           WHERE pj.requested_by = ? AND pj.idempotency_key = ? AND al.event_type = 'PRINT_JOB_CREATED') AS audits,
         (SELECT al.details FROM audit_log al INNER JOIN print_job pj ON pj.id = al.print_job_id
           WHERE pj.requested_by = ? AND pj.idempotency_key = ? AND al.event_type = 'PRINT_JOB_CREATED'
           LIMIT 1) AS auditDetails`,
      [owner.id, key, owner.id, key, owner.id, key, owner.id, key, owner.id, key],
    );
    expect(normalizeCounts(counts[0])).toEqual({ jobs: 1, payloads: 1, snapshots: 1, audits: 1 });
    expect(counts[0]?.auditDetails).not.toContain("PRINT-IT-001");
    expect(counts[0]?.auditDetails).not.toContain(key);

    const beforeRetry = await loadPrintProjection(harness.pool, first.id);
    expect(beforeRetry).toMatchObject({
      sourceCandidateRecordId,
      assignmentRegistrationId: beforeRetry.candidateRegistrationId,
      assignmentOperationSlotId: beforeRetry.operationSlotId,
      snapshotDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(beforeRetry.candidateRegistrationId).toBeGreaterThan(0);
    expect(beforeRetry.canonicalAssignmentId).toBeGreaterThan(0);
    expect(beforeRetry.operationSlotId).toBeGreaterThan(0);

    await expect(service.create(createInput(key), owner)).resolves.toEqual(first);
    expect(await loadPrintProjection(harness.pool, first.id)).toEqual(beforeRetry);
  });

  it("preserves an unlinked legacy snapshot without inferring a bridge from business_ref", async () => {
    const printJobId = randomUUID();
    const [fixtureRows] = await harness.pool.query<
      Array<RowDataPacket & { templateId: number; workstationId: number }>
    >(
      `SELECT template.id AS templateId, workstation.id AS workstationId
       FROM label_template template
       INNER JOIN workstation ON workstation.code = 'WS-DEV-001'
       WHERE template.code = 'PRINTER_TEST' AND template.version = 1 LIMIT 1`,
    );
    const fixture = fixtureRows[0];
    if (!fixture) throw new Error("Legacy print fixtures are missing.");
    await harness.pool.execute(
      `INSERT INTO print_job
        (id, job_no, label_type, business_ref, template_id, template_version,
         workstation_id, requested_by, idempotency_key, request_fingerprint,
         copies, status, expires_at)
       VALUES (?, ?, 'PSEUDONYM_LABEL', 'PRINT-IT-001', ?, 1, ?, ?, ?, REPEAT('a', 64),
               1, 'READY', DATE_ADD(NOW(3), INTERVAL 1 HOUR))`,
      [
        printJobId,
        `LEGACY-SNAPSHOT-${randomUUID()}`,
        fixture.templateId,
        fixture.workstationId,
        owner.id,
        randomUUID(),
      ],
    );
    await harness.pool.execute(
      "INSERT INTO print_job_payload (print_job_id, format, payload) VALUES (?, 'ZPL', '^XA^FDORIGINAL^FS^XZ')",
      [printJobId],
    );

    const projection = new IdentityBackfillProjectionRepository();
    const connection = await harness.pool.getConnection();
    try {
      await connection.beginTransaction();
      await projection.syncPrintSnapshot(connection, printJobId);
      await connection.commit();
    } finally {
      connection.release();
    }
    const original = await loadPrintProjection(harness.pool, printJobId);
    expect(original).toMatchObject({
      candidateRegistrationId: 0,
      canonicalAssignmentId: 0,
      operationSlotId: 0,
      sourceCandidateRecordId: 0,
      snapshotDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    await harness.pool.execute("UPDATE print_job SET job_no = ?, business_ref = 'CHANGED', copies = 2 WHERE id = ?", [
      `LEGACY-CHANGED-${randomUUID()}`,
      printJobId,
    ]);
    await harness.pool.execute("UPDATE print_job_payload SET payload = '^XA^FDCHANGED^FS^XZ' WHERE print_job_id = ?", [
      printJobId,
    ]);
    const retryConnection = await harness.pool.getConnection();
    try {
      await retryConnection.beginTransaction();
      await projection.syncPrintSnapshot(retryConnection, printJobId);
      await retryConnection.commit();
    } finally {
      retryConnection.release();
    }
    expect(await loadPrintProjection(harness.pool, printJobId)).toEqual(original);

    await service.complete(printJobId, { status: "FAILED", errorMessage: "legacy bridge missing" }, owner);
    await expect(
      service.reissue(printJobId, { idempotencyKey: randomUUID(), reasonCode: "CLIENT_SEND_RETRY" }, owner),
    ).rejects.toThrow("현재 활성 대상·가번호 연결");
  });

  it("rejects a reused idempotency key when any print request field differs", async () => {
    const key = randomUUID();
    const original = await service.create(createInput(key), owner);

    await expect(service.create(createInput(key, { copies: 2 }), owner)).rejects.toThrow(
      "새 요청 키로 다시 시도해 주세요.",
    );

    const [rows] = await harness.pool.execute<
      Array<RowDataPacket & { jobs: number; copies: number; requestFingerprint: string | null }>
    >(
      `SELECT COUNT(*) AS jobs, MAX(copies) AS copies, MAX(request_fingerprint) AS requestFingerprint
       FROM print_job WHERE requested_by = ? AND idempotency_key = ?`,
      [owner.id, key],
    );
    expect(Number(rows[0]?.jobs)).toBe(1);
    expect(Number(rows[0]?.copies)).toBe(original.copies);
    expect(rows[0]?.requestFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("allows only one of two concurrently conflicting requests for the same key", async () => {
    const key = randomUUID();
    const results = await Promise.allSettled([
      service.create(createInput(key), owner),
      service.create(createInput(key, { copies: 2 }), owner),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ message: expect.stringContaining("새 요청 키로 다시 시도해 주세요.") }),
    });

    const [rows] = await harness.pool.execute<Array<RowDataPacket & { jobs: number; copies: number }>>(
      `SELECT COUNT(*) AS jobs, MAX(copies) AS copies
       FROM print_job WHERE requested_by = ? AND idempotency_key = ?`,
      [owner.id, key],
    );
    expect(Number(rows[0]?.jobs)).toBe(1);
    expect([1, 2]).toContain(Number(rows[0]?.copies));
  });

  it("treats the same idempotency key as independent for different users", async () => {
    const key = randomUUID();
    const [first, second] = await Promise.all([
      service.create(createInput(key), owner),
      service.create(createInput(key), secondOwner),
    ]);

    expect(second.id).not.toBe(first.id);
    const [rows] = await harness.pool.execute<Array<RowDataPacket & { requestedBy: number }>>(
      "SELECT requested_by AS requestedBy FROM print_job WHERE idempotency_key = ? ORDER BY requested_by",
      [key],
    );
    expect(rows.map((row) => Number(row.requestedBy))).toEqual([owner.id, secondOwner.id].sort((a, b) => a - b));
  });

  it("serializes competing results and never reverses the stored final status", async () => {
    const job = await service.create(createInput(randomUUID()), owner);
    const [sentAttempt, failedAttempt] = await Promise.all([
      service.complete(job.id, { status: "SENT" }, owner),
      service.complete(job.id, { status: "FAILED", errorMessage: "동시 실패" }, owner),
    ]);

    expect(failedAttempt.status).toBe(sentAttempt.status);
    expect(["SENT", "FAILED"]).toContain(sentAttempt.status);
    const reverseStatus = sentAttempt.status === "SENT" ? "FAILED" : "SENT";
    const reversed = await service.complete(
      job.id,
      reverseStatus === "FAILED" ? { status: "FAILED", errorMessage: "역전 시도" } : { status: "SENT" },
      owner,
    );
    expect(reversed.status).toBe(sentAttempt.status);

    const [rows] = await harness.pool.execute<Array<RowDataPacket & { status: string; resultAudits: number }>>(
      `SELECT pj.status,
              SUM(CASE WHEN al.event_type IN ('PRINT_JOB_SENT', 'PRINT_JOB_FAILED') THEN 1 ELSE 0 END) AS resultAudits
       FROM print_job pj LEFT JOIN audit_log al ON al.print_job_id = pj.id
       WHERE pj.id = ? GROUP BY pj.id, pj.status`,
      [job.id],
    );
    expect(rows[0]?.status).toBe(sentAttempt.status);
    expect(Number(rows[0]?.resultAudits)).toBe(1);
  });

  it("expires an overdue READY job and preserves EXPIRED on later result attempts", async () => {
    const job = await service.create(createInput(randomUUID()), owner);
    await harness.pool.execute("UPDATE print_job SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?", [
      job.id,
    ]);

    await expect(service.complete(job.id, { status: "SENT" }, owner)).resolves.toEqual({
      id: job.id,
      status: "EXPIRED",
    });
    await expect(service.complete(job.id, { status: "FAILED", errorMessage: "늦은 실패" }, owner)).resolves.toEqual({
      id: job.id,
      status: "EXPIRED",
    });

    const [rows] = await harness.pool.execute<Array<RowDataPacket & { status: string; expiredAudits: number }>>(
      `SELECT pj.status,
              SUM(CASE WHEN al.event_type = 'PRINT_JOB_EXPIRED' THEN 1 ELSE 0 END) AS expiredAudits
       FROM print_job pj LEFT JOIN audit_log al ON al.print_job_id = pj.id
       WHERE pj.id = ? GROUP BY pj.id, pj.status`,
      [job.id],
    );
    expect(rows[0]?.status).toBe("EXPIRED");
    expect(Number(rows[0]?.expiredAudits)).toBe(1);
  });

  it("keeps the caller's 500-character failure message without rewriting it", async () => {
    const job = await service.create(createInput(randomUUID()), owner);
    const errorMessage = "원".repeat(500);
    await service.complete(job.id, { status: "FAILED", errorMessage }, owner);

    const [rows] = await harness.pool.execute<Array<RowDataPacket & { errorMessage: string }>>(
      "SELECT error_message AS errorMessage FROM print_job WHERE id = ?",
      [job.id],
    );
    expect(rows[0]?.errorMessage).toBe(errorMessage);
  });

  it("rolls back both creation and completion when their audit insert fails", async () => {
    const createKey = randomUUID();
    await harness.pool.query(
      `CREATE TRIGGER reject_print_audit BEFORE INSERT ON audit_log
       FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced print audit failure'`,
    );
    try {
      await expect(service.create(createInput(createKey), owner)).rejects.toThrow("forced print audit failure");
      const [rows] = await harness.pool.execute<Array<RowDataPacket & { jobs: number }>>(
        "SELECT COUNT(*) AS jobs FROM print_job WHERE requested_by = ? AND idempotency_key = ?",
        [owner.id, createKey],
      );
      expect(Number(rows[0]?.jobs)).toBe(0);
    } finally {
      await harness.pool.query("DROP TRIGGER IF EXISTS reject_print_audit");
    }

    const job = await service.create(createInput(randomUUID()), owner);
    await harness.pool.query(
      `CREATE TRIGGER reject_print_audit BEFORE INSERT ON audit_log
       FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced print audit failure'`,
    );
    try {
      await expect(service.complete(job.id, { status: "SENT" }, owner)).rejects.toThrow("forced print audit failure");
      const [rows] = await harness.pool.execute<Array<RowDataPacket & { status: string }>>(
        "SELECT status FROM print_job WHERE id = ?",
        [job.id],
      );
      expect(rows[0]?.status).toBe("READY");
    } finally {
      await harness.pool.query("DROP TRIGGER IF EXISTS reject_print_audit");
    }
  });

  it("serializes print completion behind an exclusive identity-transition gate lock", async () => {
    const job = await service.create(createInput(randomUUID()), owner);
    const gateConnection = await harness.pool.getConnection();
    let gateCommitted = false;
    try {
      await gateConnection.beginTransaction();
      await gateConnection.query("SELECT id FROM identity_transition_state WHERE id = 1 FOR UPDATE");

      const completion = service.complete(job.id, { status: "SENT" }, owner);
      await expect(
        Promise.race([
          completion.then(() => "completed"),
          new Promise<string>((resolve) => setTimeout(() => resolve("blocked"), 100)),
        ]),
      ).resolves.toBe("blocked");
      const [lockedRows] = await harness.pool.execute<Array<RowDataPacket & { status: string }>>(
        "SELECT status FROM print_job WHERE id = ?",
        [job.id],
      );
      expect(lockedRows[0]?.status).toBe("READY");

      await gateConnection.commit();
      gateCommitted = true;
      await expect(completion).resolves.toEqual({ id: job.id, status: "SENT" });
    } finally {
      if (!gateCommitted) await gateConnection.rollback();
      gateConnection.release();
    }
  });

  it("rejects a non-owner while retaining administrator override behavior", async () => {
    const job = await service.create(createInput(randomUUID()), owner);
    const nonOwner: AuthenticatedUser = {
      id: secondOwner.id,
      loginId: secondOwner.loginId,
      role: "OPERATOR",
      admissionNames: [schedule.admissionName],
    };
    await expect(service.complete(job.id, { status: "SENT" }, nonOwner)).rejects.toThrow(
      "이 출력 작업을 변경할 수 없습니다.",
    );
    await expect(service.complete(job.id, { status: "SENT" }, secondOwner)).resolves.toEqual({
      id: job.id,
      status: "SENT",
    });
  });

  it("allows a currently scoped operator and a current administrator override to reissue", async () => {
    const scopedOperator = await createScopedOperator(harness.pool);
    const job = await service.create(createInput(randomUUID()), scopedOperator.user);
    await service.complete(job.id, { status: "FAILED", errorMessage: "operator retry fixture" }, scopedOperator.user);

    await expect(
      service.reissue(job.id, { idempotencyKey: randomUUID(), reasonCode: "CLIENT_SEND_RETRY" }, scopedOperator.user),
    ).resolves.toMatchObject({ status: "READY", payload: job.payload });
    await expect(
      service.reissue(job.id, { idempotencyKey: randomUUID(), reasonCode: "PRINTER_RECOVERY" }, secondOwner),
    ).resolves.toMatchObject({ status: "READY", payload: job.payload });
  });

  it("rejects reissue when the operator's current target admission assignment was revoked", async () => {
    const scopedOperator = await createScopedOperator(harness.pool);
    const job = await service.create(createInput(randomUUID()), scopedOperator.user);
    await service.complete(job.id, { status: "FAILED", errorMessage: "scope revoke fixture" }, scopedOperator.user);
    await harness.pool.execute("DELETE FROM user_admission_scope_assignment WHERE user_id = ? AND admission_id = ?", [
      scopedOperator.user.id,
      scopedOperator.admissionId,
    ]);
    const key = randomUUID();
    await expect(
      service.reissue(job.id, { idempotencyKey: key, reasonCode: "CLIENT_SEND_RETRY" }, scopedOperator.user),
    ).rejects.toThrow("현재 배정되지 않은 전형");
    const [rows] = await harness.pool.execute<Array<RowDataPacket & { scopeMode: string; jobs: number }>>(
      `SELECT user.admission_scope_mode AS scopeMode,
              (SELECT COUNT(*) FROM print_job WHERE requested_by = user.id AND idempotency_key = ?) AS jobs
       FROM app_user user WHERE user.id = ?`,
      [key, scopedOperator.user.id],
    );
    expect(rows).toEqual([{ scopeMode: "ASSIGNED", jobs: 0 }]);
  });

  it("rejects stale target access when the operator's legacy admission assignment was revoked", async () => {
    const scopedOperator = await createScopedOperator(harness.pool);
    const job = await service.create(createInput(randomUUID()), scopedOperator.user);
    await service.complete(
      job.id,
      { status: "FAILED", errorMessage: "legacy scope revoke fixture" },
      scopedOperator.user,
    );
    await harness.pool.execute("DELETE FROM user_admission_assignment WHERE user_id = ? AND admission_name = ?", [
      scopedOperator.user.id,
      schedule.admissionName,
    ]);

    const key = randomUUID();
    await expect(
      service.reissue(job.id, { idempotencyKey: key, reasonCode: "CLIENT_SEND_RETRY" }, scopedOperator.user),
    ).rejects.toThrow("현재 배정되지 않은 전형");
    const [rows] = await harness.pool.execute<Array<RowDataPacket & { targetScope: number; jobs: number }>>(
      `SELECT
         (SELECT COUNT(*) FROM user_admission_scope_assignment
           WHERE user_id = user.id AND admission_id = ?) AS targetScope,
         (SELECT COUNT(*) FROM print_job
           WHERE requested_by = user.id AND idempotency_key = ?) AS jobs
       FROM app_user user WHERE user.id = ?`,
      [scopedOperator.admissionId, key, scopedOperator.user.id],
    );
    expect(rows.map((row) => ({ targetScope: Number(row.targetScope), jobs: Number(row.jobs) }))).toEqual([
      { targetScope: 1, jobs: 0 },
    ]);
  });

  it("uses the admission override before an enabled default and rejects a disabled current label policy", async () => {
    const job = await service.create(createInput(randomUUID()), owner);
    await service.complete(job.id, { status: "FAILED", errorMessage: "policy revoke fixture" }, owner);
    const policy = await loadCurrentPrintPolicy(harness.pool);
    const [defaultResult] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO pseudonym_policy
        (exam_cycle_id, scope_kind, admission_id, scope_key, assignment_method, print_preassigned_label)
       VALUES (?, 'DEFAULT', NULL, UNHEX(SHA2(?, 256)), 'PREASSIGNED', TRUE)`,
      [policy.examCycleId, `print-default-${randomUUID()}`],
    );
    await harness.pool.execute("UPDATE pseudonym_policy SET print_preassigned_label = FALSE WHERE id = ?", [
      policy.policyId,
    ]);
    try {
      const key = randomUUID();
      await expect(
        service.reissue(job.id, { idempotencyKey: key, reasonCode: "CLIENT_SEND_RETRY" }, owner),
      ).rejects.toThrow("현재 사전부여 라벨 출력 정책");
      const [rows] = await harness.pool.execute<Array<RowDataPacket & { jobs: number }>>(
        "SELECT COUNT(*) AS jobs FROM print_job WHERE requested_by = ? AND idempotency_key = ?",
        [owner.id, key],
      );
      expect(Number(rows[0]?.jobs)).toBe(0);
    } finally {
      await harness.pool.execute("UPDATE pseudonym_policy SET print_preassigned_label = TRUE WHERE id = ?", [
        policy.policyId,
      ]);
      await harness.pool.execute("DELETE FROM pseudonym_policy WHERE id = ?", [defaultResult.insertId]);
    }
  });

  it("falls back to the enabled default policy when no admission override exists", async () => {
    const job = await service.create(createInput(randomUUID()), owner);
    await service.complete(job.id, { status: "FAILED", errorMessage: "default policy fixture" }, owner);
    const policy = await loadCurrentPrintPolicy(harness.pool);
    await harness.pool.execute(
      `UPDATE pseudonym_policy
       SET scope_kind = 'DEFAULT', admission_id = NULL, scope_key = UNHEX(SHA2(?, 256))
       WHERE id = ?`,
      [`print-default-fallback-${randomUUID()}`, policy.policyId],
    );
    try {
      await expect(
        service.reissue(job.id, { idempotencyKey: randomUUID(), reasonCode: "CLIENT_SEND_RETRY" }, owner),
      ).resolves.toMatchObject({ status: "READY", payload: job.payload });
    } finally {
      await harness.pool.execute(
        `UPDATE pseudonym_policy
         SET scope_kind = 'ADMISSION', admission_id = ?, scope_key = ?
         WHERE id = ?`,
        [policy.admissionId, policy.scopeKey, policy.policyId],
      );
    }
  });

  it("rejects reissue after the source workstation is disabled", async () => {
    const job = await service.create(createInput(randomUUID()), owner);
    await service.complete(job.id, { status: "FAILED", errorMessage: "workstation revoke fixture" }, owner);
    await harness.pool.execute("UPDATE workstation SET enabled = FALSE WHERE code = 'WS-DEV-001'");
    try {
      await expect(
        service.reissue(job.id, { idempotencyKey: randomUUID(), reasonCode: "CLIENT_SEND_RETRY" }, owner),
      ).rejects.toThrow("비활성화된 워크스테이션");
    } finally {
      await harness.pool.execute("UPDATE workstation SET enabled = TRUE WHERE code = 'WS-DEV-001'");
    }
  });

  it("appends idempotent retry and reprint history without mutating the source jobs or snapshots", async () => {
    const original = await service.create(createInput(randomUUID()), owner);
    await service.complete(original.id, { status: "FAILED", errorMessage: "synthetic integration failure" }, owner);
    const originalProjection = await loadPrintProjection(harness.pool, original.id);
    await harness.pool.execute(
      "UPDATE print_job_payload SET payload = '^XA^FDMUTATED-SOURCE^FS^XZ' WHERE print_job_id = ?",
      [original.id],
    );
    const retryKey = randomUUID();
    const retryRequest = { idempotencyKey: retryKey, reasonCode: "CLIENT_SEND_RETRY" as const };

    const retry = await service.reissue(original.id, retryRequest, owner);
    expect(retry.payload).toBe(original.payload);
    const retryProjection = await loadPrintProjection(harness.pool, retry.id);
    await expect(service.reissue(original.id, retryRequest, owner)).resolves.toEqual(retry);

    expect(await loadPrintProjection(harness.pool, original.id)).toEqual(originalProjection);
    expect(await loadPrintProjection(harness.pool, retry.id)).toEqual(retryProjection);
    expect(retryProjection).toMatchObject({
      candidateRegistrationId: originalProjection.candidateRegistrationId,
      canonicalAssignmentId: originalProjection.canonicalAssignmentId,
      operationSlotId: originalProjection.operationSlotId,
      sourceCandidateRecordId: originalProjection.sourceCandidateRecordId,
      snapshotDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    const [retryRows] = await harness.pool.execute<
      Array<
        RowDataPacket & {
          sourceStatus: string;
          retryStatus: string;
          originalJobId: string | null;
          compatibilityReason: string | null;
          reissueType: string;
          reasonCode: string;
          actorUserId: number;
          occurredAt: Date;
          historyCount: number;
          auditCount: number;
          sourcePayloadMatches: number;
          snapshotPayloadMatches: number;
        }
      >
    >(
      `SELECT source.status AS sourceStatus, retried.status AS retryStatus,
              retried.original_job_id AS originalJobId, retried.reprint_reason AS compatibilityReason,
              event.reissue_type AS reissueType, event.reason_code AS reasonCode,
              event.actor_user_id AS actorUserId, event.occurred_at AS occurredAt,
              (SELECT COUNT(*) FROM print_job_reissue_event counted
                WHERE counted.reissued_print_job_id = retried.id) AS historyCount,
              (SELECT COUNT(*) FROM audit_log audit
                WHERE audit.print_job_id = retried.id AND audit.event_type = 'PRINT_JOB_REISSUED') AS auditCount,
              source_payload.payload = retry_payload.payload AS sourcePayloadMatches,
              JSON_UNQUOTE(JSON_EXTRACT(source_snapshot.projection_json, '$.payload')) = retry_payload.payload
                AS snapshotPayloadMatches
       FROM print_job_reissue_event event
       INNER JOIN print_job source ON source.id = event.source_print_job_id
       INNER JOIN print_job retried ON retried.id = event.reissued_print_job_id
       INNER JOIN print_job_payload source_payload ON source_payload.print_job_id = source.id
       INNER JOIN print_job_payload retry_payload ON retry_payload.print_job_id = retried.id
       INNER JOIN print_projection_snapshot source_snapshot ON source_snapshot.print_job_id = source.id
       WHERE retried.id = ?`,
      [retry.id],
    );
    expect(retryRows).toHaveLength(1);
    expect(retryRows[0]).toMatchObject({
      sourceStatus: "FAILED",
      retryStatus: "READY",
      originalJobId: original.id,
      compatibilityReason: retryRequest.reasonCode,
      reissueType: "RETRY",
      reasonCode: retryRequest.reasonCode,
      actorUserId: owner.id,
      historyCount: 1,
      auditCount: 1,
      sourcePayloadMatches: 0,
      snapshotPayloadMatches: 1,
      occurredAt: expect.any(Date),
    });
    expect(JSON.stringify(retryRows[0])).not.toContain("synthetic integration failure");

    await expect(
      harness.pool.execute(
        "UPDATE print_job_reissue_event SET reason_code = 'PRINTER_RECOVERY' WHERE reissued_print_job_id = ?",
        [retry.id],
      ),
    ).rejects.toThrow("append-only");
    await expect(
      harness.pool.execute("DELETE FROM print_job_reissue_event WHERE reissued_print_job_id = ?", [retry.id]),
    ).rejects.toThrow("append-only");

    await service.complete(retry.id, { status: "SENT" }, owner);
    await expect(
      service.reissue(retry.id, { idempotencyKey: randomUUID(), reasonCode: "CLIENT_SEND_RETRY" }, owner),
    ).rejects.toThrow("상태와 재발행 사유 코드");

    const reprint = await service.reissue(
      retry.id,
      { idempotencyKey: randomUUID(), reasonCode: "LABEL_DAMAGED" },
      owner,
    );
    const [reprintRows] = await harness.pool.execute<
      Array<
        RowDataPacket & {
          sourcePrintJobId: string;
          originalJobId: string;
          reissueType: string;
          reasonCode: string;
          actorUserId: number;
          occurredAt: Date;
        }
      >
    >(
      `SELECT event.source_print_job_id AS sourcePrintJobId, job.original_job_id AS originalJobId,
              event.reissue_type AS reissueType, event.reason_code AS reasonCode,
              event.actor_user_id AS actorUserId, event.occurred_at AS occurredAt
       FROM print_job_reissue_event event
       INNER JOIN print_job job ON job.id = event.reissued_print_job_id
       WHERE event.reissued_print_job_id = ?`,
      [reprint.id],
    );
    expect(reprintRows).toEqual([
      {
        sourcePrintJobId: retry.id,
        originalJobId: original.id,
        reissueType: "REPRINT",
        reasonCode: "LABEL_DAMAGED",
        actorUserId: owner.id,
        occurredAt: expect.any(Date),
      },
    ]);
    const reprintProjection = await loadPrintProjection(harness.pool, reprint.id);
    expect(reprintProjection).toMatchObject({
      candidateRegistrationId: retryProjection.candidateRegistrationId,
      canonicalAssignmentId: retryProjection.canonicalAssignmentId,
      operationSlotId: retryProjection.operationSlotId,
      sourceCandidateRecordId: retryProjection.sourceCandidateRecordId,
      snapshotDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("preserves the immutable snapshot and assignment history when reopen removes the current assignment", async () => {
    const job = await service.create(createInput(randomUUID()), owner);
    await service.complete(job.id, { status: "FAILED", errorMessage: "assignment removal fixture" }, owner);
    const beforeRemoval = await loadPrintProjection(harness.pool, job.id);
    expect(beforeRemoval.canonicalAssignmentId).toBeGreaterThan(0);

    const connection = await harness.pool.getConnection();
    try {
      await connection.beginTransaction();
      await new IdentityBackfillProjectionRepository().removeCurrentAssignments(
        connection,
        [sourceAssignmentId],
        owner.id,
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const afterRemoval = await loadPrintProjection(harness.pool, job.id);
    expect(afterRemoval).toMatchObject({
      candidateRegistrationId: beforeRemoval.candidateRegistrationId,
      canonicalAssignmentId: 0,
      operationSlotId: beforeRemoval.operationSlotId,
      sourceCandidateRecordId: beforeRemoval.sourceCandidateRecordId,
      snapshotJson: beforeRemoval.snapshotJson,
      snapshotDigest: beforeRemoval.snapshotDigest,
      snapshotCreatedAt: beforeRemoval.snapshotCreatedAt,
    });
    const [eventRows] = await harness.pool.execute<
      Array<RowDataPacket & { eventType: string; assignmentId: number | null }>
    >(
      `SELECT event_type AS eventType, assignment_id AS assignmentId
       FROM pseudonym_assignment_event
       WHERE registration_id = ? ORDER BY id`,
      [beforeRemoval.candidateRegistrationId],
    );
    expect(eventRows).toEqual([
      { eventType: "ASSIGNED", assignmentId: null },
      { eventType: "CURRENT_REMOVED_ON_REOPEN", assignmentId: null },
    ]);
    await expect(
      service.reissue(job.id, { idempotencyKey: randomUUID(), reasonCode: "CLIENT_SEND_RETRY" }, owner),
    ).rejects.toThrow("현재 활성 대상·가번호 연결");
  });
});

function createInput(idempotencyKey: string, overrides: Partial<CreatePrintJobDto> = {}): CreatePrintJobDto {
  return {
    examineeNo: "PRINT-IT-001",
    workstationCode: "WS-DEV-001",
    copies: 1,
    ...schedule,
    ...overrides,
    idempotencyKey,
  };
}

async function readSystemUser(pool: Pool): Promise<AuthenticatedUser> {
  const [rows] = await pool.execute<Array<RowDataPacket & { id: number }>>(
    "SELECT id FROM app_user WHERE login_id = 'system' LIMIT 1",
  );
  if (!rows[0]) throw new Error("Fresh migration did not create the system user.");
  return { id: Number(rows[0].id), loginId: "system", role: "ADMIN", admissionNames: [] };
}

async function createSecondAdmin(pool: Pool): Promise<AuthenticatedUser> {
  const [result] = await pool.execute<ResultSetHeader>(
    "INSERT INTO app_user (login_id, role, enabled) VALUES ('print-it-admin', 'ADMIN', TRUE)",
  );
  return { id: Number(result.insertId), loginId: "print-it-admin", role: "ADMIN", admissionNames: [] };
}

async function createScopedOperator(pool: Pool): Promise<{ user: AuthenticatedUser; admissionId: number }> {
  const [admissionRows] = await pool.execute<Array<RowDataPacket & { admissionId: number; examCycleId: number }>>(
    `SELECT admission.id AS admissionId, admission.exam_cycle_id AS examCycleId
     FROM admission
     INNER JOIN exam_cycle cycle ON cycle.id = admission.exam_cycle_id
     WHERE admission.canonical_name = ? AND admission.status = 'ACTIVE' AND cycle.status = 'ACTIVE'
     LIMIT 1`,
    [schedule.admissionName],
  );
  const admission = admissionRows[0];
  if (!admission) throw new Error("Canonical print admission was not created.");
  const suffix = randomUUID().slice(0, 8);
  const otherAdmissionName = `출력 권한 대조 ${suffix}`;
  const [otherAdmissionResult] = await pool.execute<ResultSetHeader>(
    `INSERT INTO admission
      (exam_cycle_id, display_name, canonical_name, identity_key, status)
     VALUES (?, ?, ?, UNHEX(SHA2(?, 256)), 'ACTIVE')`,
    [admission.examCycleId, otherAdmissionName, otherAdmissionName, `print-scope-${suffix}`],
  );
  const loginId = `print-it-operator-${suffix}`;
  const [userResult] = await pool.execute<ResultSetHeader>(
    `INSERT INTO app_user (login_id, role, enabled, admission_scope_mode)
     VALUES (?, 'OPERATOR', TRUE, 'ASSIGNED')`,
    [loginId],
  );
  const userId = Number(userResult.insertId);
  await pool.execute(
    `INSERT INTO user_admission_assignment (user_id, admission_name)
     VALUES (?, ?), (?, ?)`,
    [userId, schedule.admissionName, userId, otherAdmissionName],
  );
  await pool.execute(
    `INSERT INTO user_admission_scope_assignment (user_id, admission_id)
     VALUES (?, ?), (?, ?)`,
    [userId, admission.admissionId, userId, otherAdmissionResult.insertId],
  );
  return {
    user: {
      id: userId,
      loginId,
      role: "OPERATOR",
      admissionNames: [schedule.admissionName, otherAdmissionName],
    },
    admissionId: Number(admission.admissionId),
  };
}

async function loadCurrentPrintPolicy(
  pool: Pool,
): Promise<{ policyId: number; examCycleId: number; admissionId: number; scopeKey: Buffer }> {
  const [rows] = await pool.execute<
    Array<RowDataPacket & { policyId: number; examCycleId: number; admissionId: number; scopeKey: Buffer }>
  >(
    `SELECT policy.id AS policyId, policy.exam_cycle_id AS examCycleId,
            policy.admission_id AS admissionId, policy.scope_key AS scopeKey
     FROM pseudonym_policy policy
     INNER JOIN admission ON admission.id = policy.admission_id
     WHERE policy.scope_kind = 'ADMISSION' AND admission.canonical_name = ?
     LIMIT 1`,
    [schedule.admissionName],
  );
  const row = rows[0];
  if (!row) throw new Error("Canonical print policy was not created.");
  return {
    policyId: Number(row.policyId),
    examCycleId: Number(row.examCycleId),
    admissionId: Number(row.admissionId),
    scopeKey: row.scopeKey,
  };
}

async function seedPrintableCandidate(pool: Pool, actorId: number) {
  const [examineeResult] = await pool.execute<ResultSetHeader>(
    `INSERT INTO examinee
      (examinee_no, name, exam_name, exam_date, room_name, seat_no, label_barcode, status)
     VALUES ('PRINT-IT-001', '출력 통합', '출력 통합 시험', ?, '출력관 101호', '17', 'PRINTIT001', 'ACTIVE')`,
    [schedule.examDate],
  );
  const [candidateResult] = await pool.execute<ResultSetHeader>(
    `INSERT INTO candidate_record
      (admission, unit_name, exam_date, start_time, period_name, building_name, room_name,
       examinee_no, name, birth_date)
     VALUES (?, '출력 모집단위', ?, ?, ?, '출력관', '출력관 101호', 'PRINT-IT-001', '출력 통합', '2000-01-01')`,
    [schedule.admissionName, schedule.examDate, schedule.examTime, schedule.periodName],
  );
  const [assignmentResult] = await pool.execute<ResultSetHeader>(
    `INSERT INTO pseudonym_assignment
      (examinee_id, candidate_record_id, exam_name, admission_name, uniqueness_scope_key,
       pseudonym_no, assignment_mode, assigned_by)
     VALUES (?, ?, '출력 통합 시험', ?, '', '9001', 'MANUAL', ?)`,
    [examineeResult.insertId, candidateResult.insertId, schedule.admissionName, actorId],
  );
  const [settingResult] = await pool.execute<ResultSetHeader>(
    `INSERT INTO pseudonym_setting
      (exam_name, admission_name, range_start, range_end, next_sequence,
       assignment_method, print_preassigned_label, updated_by)
     VALUES (?, ?, 9001, 9001, 9001, 'PREASSIGNED', TRUE, ?)`,
    [schedule.examName, schedule.admissionName, actorId],
  );
  return {
    sourceCandidateRecordId: Number(candidateResult.insertId),
    sourceAssignmentId: Number(assignmentResult.insertId),
    sourceSettingId: Number(settingResult.insertId),
  };
}

async function seedCanonicalPrintIdentity(
  pool: Pool,
  source: { sourceCandidateRecordId: number; sourceAssignmentId: number; sourceSettingId: number },
): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const candidateProjection = await new CandidateIdentityRepository().syncCandidateRecord(
      connection,
      source.sourceCandidateRecordId,
      schedule.examName,
    );
    const identityProjection = new IdentityBackfillProjectionRepository();
    await identityProjection.syncSetting(connection, source.sourceSettingId, candidateProjection.examCycleId);
    await identityProjection.syncAssignment(connection, source.sourceAssignmentId, candidateProjection.examCycleId);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function loadPrintProjection(pool: Pool, printJobId: string) {
  const [rows] = await pool.execute<
    Array<
      RowDataPacket & {
        candidateRegistrationId: number | null;
        canonicalAssignmentId: number | null;
        operationSlotId: number | null;
        sourceCandidateRecordId: number | null;
        assignmentRegistrationId: number | null;
        assignmentOperationSlotId: number | null;
        snapshotJson: string;
        snapshotDigest: string;
        snapshotCreatedAt: Date;
      }
    >
  >(
    `SELECT job.candidate_registration_id AS candidateRegistrationId,
            job.canonical_assignment_id AS canonicalAssignmentId,
            job.operation_slot_id AS operationSlotId,
            registration.source_candidate_record_id AS sourceCandidateRecordId,
            assignment.registration_id AS assignmentRegistrationId,
            assignment_operation.operation_slot_id AS assignmentOperationSlotId,
            CAST(snapshot.projection_json AS CHAR) AS snapshotJson,
            snapshot.projection_digest AS snapshotDigest,
            snapshot.created_at AS snapshotCreatedAt
     FROM print_job job
     LEFT JOIN candidate_registration registration ON registration.id = job.candidate_registration_id
     LEFT JOIN candidate_pseudonym_assignment assignment ON assignment.id = job.canonical_assignment_id
     LEFT JOIN pseudonym_operation_state assignment_operation
       ON assignment_operation.id = assignment.pseudonym_operation_id
     INNER JOIN print_projection_snapshot snapshot ON snapshot.print_job_id = job.id
     WHERE job.id = ?`,
    [printJobId],
  );
  const row = rows[0];
  if (!row) throw new Error(`Print projection was not created for ${printJobId}.`);
  return {
    candidateRegistrationId: Number(row.candidateRegistrationId ?? 0),
    canonicalAssignmentId: Number(row.canonicalAssignmentId ?? 0),
    operationSlotId: Number(row.operationSlotId ?? 0),
    sourceCandidateRecordId: Number(row.sourceCandidateRecordId ?? 0),
    assignmentRegistrationId: Number(row.assignmentRegistrationId ?? 0),
    assignmentOperationSlotId: Number(row.assignmentOperationSlotId ?? 0),
    snapshotJson: row.snapshotJson,
    snapshotDigest: row.snapshotDigest,
    snapshotCreatedAt: row.snapshotCreatedAt,
  };
}

function normalizeCounts(
  row: (RowDataPacket & { jobs: number; payloads: number; snapshots?: number; audits: number }) | undefined,
) {
  return {
    jobs: Number(row?.jobs),
    payloads: Number(row?.payloads),
    ...(row?.snapshots === undefined ? {} : { snapshots: Number(row.snapshots) }),
    audits: Number(row?.audits),
  };
}
