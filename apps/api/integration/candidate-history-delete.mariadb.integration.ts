import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { AuthenticatedUser } from "../src/auth/auth.types.js";
import { resolveAppConfig } from "../src/config/app-config.js";
import { PrintJobsService } from "../src/print-jobs/print-jobs.service.js";
import { PseudonymsService } from "../src/pseudonyms/pseudonyms.service.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

let harness: MariaDbIntegrationHarness;
let user: AuthenticatedUser;
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
const candidates: Array<{ id: number; no: string; scope: typeof scope; jobId: string }> = [];

beforeAll(async () => {
  harness = await createMariaDbIntegrationHarness();
  const [users] = await harness.pool.query<RowDataPacket[]>("SELECT id FROM app_user WHERE login_id = 'system'");
  const [stations] = await harness.pool.query<RowDataPacket[]>(
    "SELECT code FROM workstation WHERE enabled = TRUE LIMIT 1",
  );
  user = { id: Number(users[0]!.id), loginId: "system", role: "ADMIN", admissionNames: [] };
  workstationCode = String(stations[0]!.code);
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

function target(index: number, mode: "LABEL" | "ASSIGNMENT" = "LABEL") {
  const candidate = candidates[index]!;
  return { ...candidate.scope, candidateRecordId: candidate.id, examineeNo: candidate.no, mode };
}

it("restricts deletion to the exact candidate, exam and authorized schedule", async () => {
  await expect(operations.deleteCandidateHistory({ ...target(0), examName: "다른 시험" }, user)).rejects.toThrow(
    "수험생",
  );
  await expect(
    operations.deleteCandidateHistory({ ...target(0), examineeNo: candidates[1]!.no }, user),
  ).rejects.toThrow("수험생");
  await expect(operations.deleteCandidateHistory({ ...target(0), examTime: "10:00" }, user)).rejects.toThrow("수험생");
  await expect(
    operations.deleteCandidateHistory(target(0), { ...user, role: "OPERATOR", admissionNames: ["다른 전형"] }),
  ).rejects.toThrow();
  await expect(operations.deleteCandidateHistory(target(0, "ASSIGNMENT"), user)).rejects.toThrow("설정이 변경");
  const [jobs] = await harness.pool.query<RowDataPacket[]>("SELECT status FROM print_job");
  expect(jobs.every((job) => job.status === "SENT")).toBe(true);
});

it("deletes only the selected print history, preserves its number and the closed schedule", async () => {
  await operations.closeOperation(scope, user);
  expect(await operations.deleteCandidateHistory(target(0), user)).toMatchObject({
    mode: "LABEL",
    resetPrintCount: 1,
    deletedAssignmentCount: 0,
  });
  const [jobs] = await harness.pool.query<RowDataPacket[]>("SELECT id, status, sent_at FROM print_job");
  expect(jobs.find((job) => job.id === candidates[0]!.jobId)).toMatchObject({ status: "CANCELLED", sent_at: null });
  for (const candidate of candidates.slice(1))
    expect(jobs.find((job) => job.id === candidate.jobId)?.status).toBe("SENT");
  const [assignments] = await harness.pool.query<RowDataPacket[]>(
    "SELECT candidate_record_id FROM pseudonym_assignment",
  );
  expect(assignments).toHaveLength(candidates.length);
  expect(await operations.getOperationStatus(scope, user)).toMatchObject({ closed: true });
});

it("blocks deletion during pending output and permits printing after a history deletion", async () => {
  const pending = await printing.create(
    { ...scope, examineeNo: candidates[0]!.no, workstationCode, copies: 1, idempotencyKey: randomUUID() },
    user,
  );
  await expect(operations.deleteCandidateHistory(target(0), user)).rejects.toThrow("진행 중인 라벨 출력");
  await printing.complete(pending.id, { status: "SENT" }, user);
});

it("deletes a selected assignment without changing other candidates or the operation status", async () => {
  await harness.pool.execute(
    "UPDATE pseudonym_setting SET assignment_method = 'MATCHING', print_preassigned_label = FALSE WHERE exam_name = ? AND admission_name = ?",
    [scope.examName, scope.admissionName],
  );
  expect(await operations.deleteCandidateHistory(target(1, "ASSIGNMENT"), user)).toMatchObject({
    mode: "ASSIGNMENT",
    deletedAssignmentCount: 1,
    resetPrintCount: 0,
  });
  const [assignments] = await harness.pool.query<RowDataPacket[]>(
    "SELECT candidate_record_id FROM pseudonym_assignment",
  );
  expect(assignments).toHaveLength(candidates.length - 1);
  expect(assignments.some((row) => row.candidate_record_id === candidates[1]!.id)).toBe(false);
  const [jobs] = await harness.pool.query<RowDataPacket[]>("SELECT status FROM print_job WHERE id = ?", [
    candidates[1]!.jobId,
  ]);
  expect(jobs[0]!.status).toBe("SENT");
  expect(await operations.getOperationStatus(scope, user)).toMatchObject({ closed: true });
});

it("clears the imported number in preassigned mode without label printing", async () => {
  await harness.pool.execute(
    "UPDATE pseudonym_setting SET assignment_method = 'PREASSIGNED', print_preassigned_label = FALSE WHERE exam_name = ? AND admission_name = ?",
    [scope.examName, scope.admissionName],
  );
  expect(await operations.deleteCandidateHistory(target(0, "ASSIGNMENT"), user)).toMatchObject({
    clearedPreassigned: true,
    deletedAssignmentCount: 1,
  });
  const [rows] = await harness.pool.query<RowDataPacket[]>("SELECT temporary_no FROM candidate_record WHERE id = ?", [
    candidates[0]!.id,
  ]);
  expect(rows[0]!.temporary_no).toBe("");
  const [audits] = await harness.pool.query<RowDataPacket[]>(
    "SELECT details FROM audit_log WHERE event_type = 'CANDIDATE_HISTORY_DELETED'",
  );
  expect(audits).toHaveLength(3);
});
