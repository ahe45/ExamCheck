import { randomUUID } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../src/auth/auth.types.js";
import { resolveAppConfig } from "../src/config/app-config.js";
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

beforeAll(async () => {
  harness = await createMariaDbIntegrationHarness();
  owner = await readSystemUser(harness.pool);
  secondOwner = await createSecondAdmin(harness.pool);
  await seedPrintableCandidate(harness.pool, owner.id);
  service = new PrintJobsService(harness.pool, resolveAppConfig({ PRINT_JOB_EXPIRY_SECONDS: "300" }));
});

afterAll(async () => {
  if (harness) await harness.cleanup();
});

describe("print job MariaDB integration", () => {
  it("applies the nullable per-user idempotency and request-fingerprint migrations on a fresh database", async () => {
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
      Array<RowDataPacket & { jobs: number; payloads: number; audits: number; auditDetails: string }>
    >(
      `SELECT
         (SELECT COUNT(*) FROM print_job WHERE requested_by = ? AND idempotency_key = ?) AS jobs,
         (SELECT COUNT(*) FROM print_job_payload pjp INNER JOIN print_job pj ON pj.id = pjp.print_job_id
           WHERE pj.requested_by = ? AND pj.idempotency_key = ?) AS payloads,
         (SELECT COUNT(*) FROM audit_log al INNER JOIN print_job pj ON pj.id = al.print_job_id
           WHERE pj.requested_by = ? AND pj.idempotency_key = ? AND al.event_type = 'PRINT_JOB_CREATED') AS audits,
         (SELECT al.details FROM audit_log al INNER JOIN print_job pj ON pj.id = al.print_job_id
           WHERE pj.requested_by = ? AND pj.idempotency_key = ? AND al.event_type = 'PRINT_JOB_CREATED'
           LIMIT 1) AS auditDetails`,
      [owner.id, key, owner.id, key, owner.id, key, owner.id, key],
    );
    expect(normalizeCounts(counts[0])).toEqual({ jobs: 1, payloads: 1, audits: 1 });
    expect(counts[0]?.auditDetails).not.toContain("PRINT-IT-001");
    expect(counts[0]?.auditDetails).not.toContain(key);
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
  await pool.execute(
    `INSERT INTO pseudonym_assignment
      (examinee_id, candidate_record_id, exam_name, admission_name, uniqueness_scope_key,
       pseudonym_no, assignment_mode, assigned_by)
     VALUES (?, ?, '출력 통합 시험', ?, '', '9001', 'MANUAL', ?)`,
    [examineeResult.insertId, candidateResult.insertId, schedule.admissionName, actorId],
  );
  await pool.execute(
    `INSERT INTO pseudonym_setting
      (exam_name, admission_name, range_start, range_end, next_sequence,
       assignment_method, print_preassigned_label, updated_by)
     VALUES (?, ?, 9001, 9001, 9001, 'PREASSIGNED', TRUE, ?)`,
    [schedule.examName, schedule.admissionName, actorId],
  );
}

function normalizeCounts(row: (RowDataPacket & { jobs: number; payloads: number; audits: number }) | undefined) {
  return {
    jobs: Number(row?.jobs),
    payloads: Number(row?.payloads),
    audits: Number(row?.audits),
  };
}
