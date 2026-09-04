import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
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
let workstationCode = "";

beforeAll(async () => {
  harness = await createMariaDbIntegrationHarness();
  const [identityRows] = await harness.pool.execute<
    Array<RowDataPacket & { userId: number; workstationCode: string }>
  >(
    `SELECT u.id AS userId, w.code AS workstationCode
     FROM app_user u
     INNER JOIN workstation w ON w.enabled = TRUE
     WHERE u.login_id = 'system'
     ORDER BY w.id LIMIT 1`,
  );
  const identity = identityRows[0];
  if (!identity) throw new Error("Print integration identity fixture is missing.");
  owner = { id: Number(identity.userId), loginId: "system", role: "ADMIN", admissionNames: [] };
  workstationCode = identity.workstationCode;

  const [candidateResult] = await harness.pool.execute<ResultSetHeader>(
    `INSERT INTO candidate_record
      (designated_sort, admission, unit_name, exam_date, start_time, period_name,
       building_name, room_name, examinee_no, temporary_no, label_barcode, status,
       name, exam_name, birth_date)
     VALUES ('17', ?, '통합 모집단위', ?, ?, ?, '통합관', '통합 101호',
             'PRINT-IT-001', '8171', 'EX-PRINT-IT-001', 'ACTIVE', '출력 통합 수험생', ?, '2000-01-01')`,
    [schedule.admissionName, schedule.examDate, schedule.examTime, schedule.periodName, schedule.examName],
  );
  await harness.pool.execute(
    `INSERT INTO pseudonym_assignment
      (candidate_record_id, exam_name, admission_name, uniqueness_scope_key,
       pseudonym_no, assignment_mode, assigned_by)
     VALUES (?, ?, ?, '', '8171', 'PREASSIGNED', ?)`,
    [candidateResult.insertId, schedule.examName, schedule.admissionName, owner.id],
  );
  await harness.pool.execute(
    `INSERT INTO pseudonym_setting
      (exam_name, admission_name, range_start, range_end, next_sequence,
       assignment_method, print_preassigned_label, updated_by)
     VALUES (?, ?, 8000, 8999, 8172, 'PREASSIGNED', TRUE, ?)`,
    [schedule.examName, schedule.admissionName, owner.id],
  );

  service = new PrintJobsService(harness.pool, resolveAppConfig({ PRINT_JOB_EXPIRY_SECONDS: "300" }));
});

afterAll(async () => {
  if (harness) await harness.cleanup();
});

describe("print job MariaDB integration", () => {
  it("creates one persisted job and returns it for an identical retry", async () => {
    const request = createRequest();
    const created = await service.create(request, owner);
    const retried = await service.create(request, owner);

    expect(created).toMatchObject({ status: "READY", copies: 1, format: "ZPL" });
    expect(created.payload).toContain("8171");
    expect(retried).toEqual(created);

    const [rows] = await harness.pool.execute<Array<RowDataPacket & { jobCount: number; payloadCount: number }>>(
      `SELECT COUNT(DISTINCT pj.id) AS jobCount, COUNT(pjp.print_job_id) AS payloadCount
       FROM print_job pj
       INNER JOIN print_job_payload pjp ON pjp.print_job_id = pj.id
       WHERE pj.requested_by = ? AND pj.idempotency_key = ?`,
      [owner.id, request.idempotencyKey],
    );
    expect(rows).toEqual([{ jobCount: 1, payloadCount: 1 }]);
  });

  it("persists a terminal sent status", async () => {
    const created = await service.create(createRequest(), owner);

    await expect(service.complete(created.id, { status: "SENT" }, owner)).resolves.toEqual({
      id: created.id,
      status: "SENT",
    });

    const [rows] = await harness.pool.execute<Array<RowDataPacket & { status: string }>>(
      "SELECT status FROM print_job WHERE id = ?",
      [created.id],
    );
    expect(rows).toEqual([{ status: "SENT" }]);
  });

  it("runs only on the simplified operational tables", async () => {
    const [rows] = await harness.pool.execute<Array<RowDataPacket & { tableCount: number }>>(
      `SELECT COUNT(*) AS tableCount
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN (
           'examinee', 'form_template_deletion', 'identity_transition_state',
           'print_job_reissue_event', 'print_projection_snapshot',
           'exam_cycle', 'admission', 'candidate', 'candidate_registration'
         )`,
    );
    expect(Number(rows[0]?.tableCount)).toBe(0);
  });
});

function createRequest(): CreatePrintJobDto {
  return {
    idempotencyKey: randomUUID(),
    examineeNo: "PRINT-IT-001",
    workstationCode,
    copies: 1,
    examDate: schedule.examDate,
    examTime: schedule.examTime,
    periodName: schedule.periodName,
    admissionName: schedule.admissionName,
  };
}
