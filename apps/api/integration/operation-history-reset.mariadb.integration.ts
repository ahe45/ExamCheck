import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { AuthenticatedUser } from "../src/auth/auth.types.js";
import { verifyPassword } from "../src/auth/password.js";
import { MutationAuditRepository } from "../src/common/audit/mutation-audit.repository.js";
import { resolveAppConfig } from "../src/config/app-config.js";
import { DeveloperSettingsService } from "../src/developer-settings/developer-settings.service.js";
import { PrintJobsService } from "../src/print-jobs/print-jobs.service.js";
import { PseudonymsService } from "../src/pseudonyms/pseudonyms.service.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

let harness: MariaDbIntegrationHarness;
let user: AuthenticatedUser;
let settings: DeveloperSettingsService;
let operations: PseudonymsService;
let printing: PrintJobsService;
let workstationCode: string;
const scope = {
  examName: "초기화 시험",
  admissionName: "초기화 전형",
  examDate: "2038-05-17",
  examTime: "09:00",
  periodName: "1교시",
};
const password = "reset-test-password";
const request = { ...scope, password, mode: "LABEL" as const };
const candidates: Array<{ id: number; no: string; scope: typeof scope; jobId: string }> = [];

beforeAll(async () => {
  harness = await createMariaDbIntegrationHarness();
  const [users] = await harness.pool.query<RowDataPacket[]>("SELECT id FROM app_user WHERE login_id = 'system'");
  const [stations] = await harness.pool.query<RowDataPacket[]>(
    "SELECT code FROM workstation WHERE enabled = TRUE LIMIT 1",
  );
  user = { id: Number(users[0]!.id), loginId: "system", role: "ADMIN", admissionNames: [] };
  workstationCode = String(stations[0]!.code);
  settings = new DeveloperSettingsService(harness.pool, new MutationAuditRepository());
  operations = new PseudonymsService(harness.pool);
  printing = new PrintJobsService(harness.pool, resolveAppConfig({ PRINT_JOB_EXPIRY_SECONDS: "300" }));
  const scopes = [
    scope,
    scope,
    { ...scope, examTime: "10:00" },
    { ...scope, periodName: "2교시" },
    { ...scope, examDate: "2038-05-18" },
    { ...scope, admissionName: "다른 전형" },
    { ...scope, examName: "다른 시험" },
  ];
  for (const [index, item] of scopes.entries()) {
    await harness.pool.execute(
      `INSERT IGNORE INTO pseudonym_setting
      (exam_name, admission_name, range_start, range_end, display_width, next_sequence, assignment_method, print_preassigned_label, updated_by)
      VALUES (?, ?, 8000, 8999, 4, 8100, 'PREASSIGNED', TRUE, ?)`,
      [item.examName, item.admissionName, user.id],
    );
    const no = `RESET-${index}`;
    const [row] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO candidate_record
      (unit_name, building_name, room_name, admission, exam_date, start_time, period_name, examinee_no, temporary_no, label_barcode, name, exam_name)
      VALUES ('단위', '본관', '101호', ?, ?, ?, ?, ?, ?, ?, '초기화 수험생', ?)`,
      [
        item.admissionName,
        item.examDate,
        item.examTime,
        item.periodName,
        no,
        String(8000 + index),
        `BC-${no}`,
        item.examName,
      ],
    );
    await harness.pool.execute(
      `INSERT INTO pseudonym_assignment
      (candidate_record_id, exam_name, admission_name, uniqueness_scope_key, pseudonym_no, assignment_mode, assigned_by)
      VALUES (?, ?, ?, '', ?, 'PREASSIGNED', ?)`,
      [row.insertId, item.examName, item.admissionName, String(8000 + index), user.id],
    );
    const job = await printing.create(
      { ...item, examineeNo: no, workstationCode, copies: 1, idempotencyKey: randomUUID() },
      user,
    );
    await printing.complete(job.id, { status: "SENT" }, user);
    candidates.push({ id: row.insertId, no, scope: item, jobId: job.id });
  }
});

afterAll(async () => {
  if (harness) await harness.cleanup();
});

it("requires a configured password and stores only its hash", async () => {
  expect(await settings.getHistoryResetPassword()).toEqual({ configured: false });
  await expect(operations.resetOperationHistory(request, user)).rejects.toThrow("먼저 설정");
  await settings.updateHistoryResetPassword(password, user);
  expect(await settings.getHistoryResetPassword()).toEqual({ configured: true });
  const [rows] = await harness.pool.query<RowDataPacket[]>(
    "SELECT history_reset_password_hash AS hash FROM system_profile WHERE id = 1",
  );
  expect(rows[0]!.hash).not.toBe(password);
  expect(await verifyPassword(password, rows[0]!.hash)).toBe(true);
});

it("rejects incorrect passwords, other admissions and changed operation modes without changing histories", async () => {
  await expect(operations.resetOperationHistory({ ...request, password: "wrong" }, user)).rejects.toThrow("올바르지");
  await expect(
    operations.resetOperationHistory(request, { ...user, role: "OPERATOR", admissionNames: ["다른 전형"] }),
  ).rejects.toThrow();
  await expect(operations.resetOperationHistory({ ...request, mode: "ASSIGNMENT" }, user)).rejects.toThrow(
    "설정이 변경",
  );
  const [rows] = await harness.pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM print_job WHERE status = 'SENT'",
  );
  expect(Number(rows[0]!.total)).toBe(candidates.length);
});

it("resets only the selected schedule's print history and permits printing again while preserving assigned numbers", async () => {
  await harness.pool.execute(
    `INSERT INTO pseudonym_operation
    (exam_name, admission_name, exam_date, exam_time, period_name, closed) VALUES (?, ?, ?, ?, ?, TRUE)`,
    [scope.examName, scope.admissionName, scope.examDate, scope.examTime, scope.periodName],
  );
  expect(await operations.resetOperationHistory(request, user)).toMatchObject({
    mode: "LABEL",
    resetPrintCount: 2,
    deletedAssignmentCount: 0,
  });
  const [rows] = await harness.pool.query<RowDataPacket[]>("SELECT id, status, sent_at FROM print_job");
  for (const [index, candidate] of candidates.entries()) {
    const row = rows.find((item) => item.id === candidate.jobId)!;
    expect(row.status).toBe(index < 2 ? "CANCELLED" : "SENT");
    if (index < 2) expect(row.sent_at).toBeNull();
  }
  const [assignments] = await harness.pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM pseudonym_assignment WHERE exam_name IN ('초기화 시험', '다른 시험')",
  );
  expect(Number(assignments[0]!.total)).toBe(candidates.length);
  expect((await operations.getOperationStatus(scope, user)).closed).toBe(false);
  expect(await printing.complete(candidates[0]!.jobId, { status: "SENT" }, user)).toMatchObject({
    status: "CANCELLED",
  });
  const job = await printing.create(
    { ...scope, examineeNo: candidates[0]!.no, workstationCode, copies: 1, idempotencyKey: randomUUID() },
    user,
  );
  await expect(operations.resetOperationHistory(request, user)).rejects.toThrow("진행 중인");
  await printing.complete(job.id, { status: "FAILED" }, user);
});

it("clears assigned numbers only in the selected schedule and restores its sequence", async () => {
  await harness.pool.execute(
    "UPDATE pseudonym_setting SET assignment_method = 'SEQUENTIAL', print_preassigned_label = FALSE WHERE exam_name = ? AND admission_name = ?",
    [scope.examName, scope.admissionName],
  );
  await harness.pool.execute(
    `INSERT INTO pseudonym_time_range
    (setting_id, schedule_key, exam_date, exam_time, period_name, admission, range_start, range_end, display_width, next_sequence, updated_by)
    SELECT id, 'reset-test-scope', ?, ?, ?, ?, 8000, 8099, 4, 8002, ? FROM pseudonym_setting WHERE exam_name = ? AND admission_name = ?`,
    [
      scope.examDate,
      scope.examTime,
      scope.periodName,
      scope.admissionName,
      user.id,
      scope.examName,
      scope.admissionName,
    ],
  );
  expect(await operations.resetOperationHistory({ ...request, mode: "ASSIGNMENT" }, user)).toMatchObject({
    deletedAssignmentCount: 2,
    resetPrintCount: 0,
  });
  const [assignments] = await harness.pool.query<RowDataPacket[]>(
    "SELECT candidate_record_id AS id FROM pseudonym_assignment",
  );
  expect(assignments.some((row) => row.id === candidates[0]!.id || row.id === candidates[1]!.id)).toBe(false);
  for (const candidate of candidates.slice(2)) expect(assignments.some((row) => row.id === candidate.id)).toBe(true);
  const [ranges] = await harness.pool.query<RowDataPacket[]>(
    "SELECT next_sequence FROM pseudonym_time_range WHERE schedule_key = 'reset-test-scope'",
  );
  expect(ranges[0]!.next_sequence).toBe(8000);
  const [audits] = await harness.pool.query<RowDataPacket[]>(
    "SELECT details FROM audit_log WHERE event_type IN ('OPERATION_HISTORY_RESET', 'HISTORY_RESET_PASSWORD_CHANGED')",
  );
  expect(JSON.stringify(audits)).not.toContain(password);
  expect(audits.length).toBe(3);
});
