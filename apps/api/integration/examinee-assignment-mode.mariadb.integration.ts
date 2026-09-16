import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ExamineesRepository } from "../src/examinees/examinees.repository.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

let harness: MariaDbIntegrationHarness;
let repository: ExamineesRepository;
let candidateId: number;
let actorId: number;
const scope = { date: "2039-01-02", time: "09:00", periodName: "1교시", admissionName: "추첨 검증" };

beforeAll(async () => {
  harness = await createMariaDbIntegrationHarness();
  repository = new ExamineesRepository(harness.pool);
  const [users] = await harness.pool.query<RowDataPacket[]>("SELECT id FROM app_user WHERE login_id = 'system'");
  actorId = Number(users[0]!.id);
  await harness.pool.execute(
    `INSERT INTO pseudonym_setting
    (exam_name, admission_name, range_start, range_end, display_width, next_sequence, assignment_method, updated_by)
    VALUES ('추첨 검증 시험', ?, 8000, 8999, 4, 8000, 'DRAW', ?)`,
    [scope.admissionName, actorId],
  );
  const [row] = await harness.pool.execute<ResultSetHeader>(
    `INSERT INTO candidate_record
    (unit_name, building_name, room_name, admission, exam_date, start_time, period_name, examinee_no, temporary_no, label_barcode, name, exam_name)
    VALUES ('단위', '본관', '101호', ?, ?, ?, ?, 'DRAW-TEST', '0821', 'DRAW-TEST', '검증 수험생', '추첨 검증 시험')`,
    [scope.admissionName, scope.date, scope.time, scope.periodName],
  );
  candidateId = row.insertId;
});
afterAll(async () => {
  if (harness) await harness.cleanup();
});

it.each(["DRAW", "SEQUENTIAL", "MATCHING", "PREASSIGNED"])(
  "%s uses uploaded numbers as assignments only in preassigned mode",
  async (mode) => {
    await harness.pool.execute(
      "UPDATE pseudonym_setting SET assignment_method = ? WHERE exam_name = '추첨 검증 시험'",
      [mode],
    );
    const expected = mode === "PREASSIGNED" ? "0821" : null;
    const candidate = await repository.findCurrent("DRAW-TEST", scope, scope.admissionName);
    expect(candidate).toMatchObject({
      preassignedNumber: "0821",
      assignedNumber: expected,
      assignmentMode: expected ? "PREASSIGNED" : null,
    });
    expect((await repository.listRoster(scope, scope.admissionName))[0]!.assignedNumber).toBe(expected);
    const schedules = await repository.listSchedules({ sql: "cr.admission IN (?)", params: [scope.admissionName] });
    expect(schedules[0]!.assignedCount).toBe(expected ? 1 : 0);
  },
);

it("preserves actual assignments when switching to draw mode", async () => {
  await harness.pool.execute(
    "UPDATE pseudonym_setting SET assignment_method = 'DRAW' WHERE exam_name = '추첨 검증 시험'",
  );
  await harness.pool.execute(
    `INSERT INTO pseudonym_assignment
    (candidate_record_id, exam_name, admission_name, uniqueness_scope_key, pseudonym_no, assignment_mode, assigned_by)
    VALUES (?, '추첨 검증 시험', ?, '', '8001', 'RANDOM', ?)`,
    [candidateId, scope.admissionName, actorId],
  );
  expect(await repository.findCurrent("DRAW-TEST", scope, scope.admissionName)).toMatchObject({
    assignedNumber: "8001",
    assignmentMode: "RANDOM",
  });
});

it("uses the active default setting when the admission-specific setting is inactive", async () => {
  await harness.pool.execute("DELETE FROM pseudonym_assignment WHERE candidate_record_id = ?", [candidateId]);
  await harness.pool.execute("UPDATE pseudonym_setting SET active = FALSE WHERE exam_name = '추첨 검증 시험'");
  await harness.pool.execute(
    `INSERT INTO pseudonym_setting
    (exam_name, admission_name, range_start, range_end, display_width, next_sequence, assignment_method, updated_by)
    VALUES ('추첨 검증 시험', '', 8000, 8999, 4, 8000, 'PREASSIGNED', ?)`,
    [actorId],
  );
  expect(await repository.findCurrent("DRAW-TEST", scope, scope.admissionName)).toMatchObject({
    assignedNumber: "0821",
    assignmentMode: "PREASSIGNED",
  });
});
