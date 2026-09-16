import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { AdmissionAccessPredicate } from "../src/authorization/admission-policy.js";
import { ExamineesRepository } from "../src/examinees/examinees.repository.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

let harness: MariaDbIntegrationHarness;
let repository: ExamineesRepository;
let actorId: number;
const exam = "교시 출력 진행률 시험";
const admission = "출력 진행률 전형";
const access: AdmissionAccessPredicate = { sql: "cr.admission IN (?)", params: [admission] };
const ids: number[] = [];

beforeAll(async () => {
  harness = await createMariaDbIntegrationHarness();
  repository = new ExamineesRepository(harness.pool);
  const [users] = await harness.pool.query<RowDataPacket[]>("SELECT id FROM app_user WHERE login_id = 'system'");
  actorId = Number(users[0]!.id);
  await harness.pool.execute(
    `INSERT INTO pseudonym_setting
    (exam_name, admission_name, range_start, range_end, display_width, next_sequence, assignment_method, print_preassigned_label, updated_by)
    VALUES (?, '', 8000, 8999, 4, 8000, 'PREASSIGNED', TRUE, ?)`,
    [exam, actorId],
  );
  for (let index = 0; index < 5; index++) {
    const [row] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO candidate_record
      (unit_name, building_name, room_name, admission, exam_date, start_time, period_name, examinee_no, temporary_no, label_barcode, name, exam_name)
      VALUES ('단위', '본관', '101호', ?, '2039-01-02', ?, ?, ?, ?, ?, '검증 수험생', ?)`,
      [
        admission,
        index < 4 ? "09:00" : "13:00",
        index < 4 ? "1교시" : "2교시",
        `PROGRESS-${index}`,
        `800${index}`,
        `PROGRESS-${index}`,
        exam,
      ],
    );
    ids.push(row.insertId);
  }
  await printJob(ids[0]!, "SENT", true, 3);
  await printJob(ids[0]!, "SENT", true); // Retry counts as the same person.
  await printJob(ids[1]!, "READY", false);
  await printJob(ids[1]!, "FAILED", false);
  await printJob(ids[2]!, "SENT", false); // Missing completion timestamp is not printed.
  await printJob(ids[3]!, "SENT", true, 1, "OTHER_LABEL");
  await printJob(ids[4]!, "SENT", true);
});
afterAll(async () => {
  if (harness) await harness.cleanup();
});

it("사전부여·출력 사용 시 교시별 완료 인원을 중복 없이 집계한다", async () => {
  const schedules = await repository.listSchedules(access);
  expect(schedules).toMatchObject([
    { periodName: "1교시", candidateCount: 4, assignedCount: 4, printedCount: 1, labelPrintingEnabled: true },
    { periodName: "2교시", candidateCount: 1, assignedCount: 1, printedCount: 1, labelPrintingEnabled: true },
  ]);
});

it("출력 완료가 추가되거나 출력 이력이 초기화되면 다음 조회에 반영한다", async () => {
  await printJob(ids[1]!, "SENT", true);
  expect((await repository.listSchedules(access))[0]!.printedCount).toBe(2);
  await harness.pool.execute("DELETE FROM print_job WHERE candidate_record_id = ? AND status = 'SENT'", [ids[1]]);
  expect((await repository.listSchedules(access))[0]!.printedCount).toBe(1);
});

it.each([
  ["PREASSIGNED", false, false, 4],
  ["DRAW", true, false, 0],
  ["PREASSIGNED", true, true, 4],
] as const)("전형 설정 %s / 출력 %s를 기본 설정보다 우선 적용한다", async (method, print, enabled, assigned) => {
  await harness.pool.execute(
    `INSERT INTO pseudonym_setting
    (exam_name, admission_name, range_start, range_end, display_width, next_sequence, assignment_method, print_preassigned_label, updated_by)
    VALUES (?, ?, 8000, 8999, 4, 8000, ?, ?, ?)
    ON DUPLICATE KEY UPDATE assignment_method = VALUES(assignment_method), print_preassigned_label = VALUES(print_preassigned_label), active = TRUE`,
    [exam, admission, method, print, actorId],
  );
  expect((await repository.listSchedules(access))[0]).toMatchObject({
    assignedCount: assigned,
    printedCount: 1,
    labelPrintingEnabled: enabled,
  });
});

it("비활성 전형 설정 대신 기본 설정을 적용하고 전형 접근 범위를 지킨다", async () => {
  await harness.pool.execute(
    "UPDATE pseudonym_setting SET active = FALSE, print_preassigned_label = FALSE WHERE exam_name = ? AND admission_name = ?",
    [exam, admission],
  );
  expect((await repository.listSchedules(access))[0]!.labelPrintingEnabled).toBe(true);
  expect(await repository.listSchedules({ sql: "cr.admission IN (?)", params: ["다른 전형"] })).toEqual([]);
});

async function printJob(candidateId: number, status: string, sent: boolean, copies = 1, labelType = "PSEUDONYM_LABEL") {
  const id = randomUUID();
  await harness.pool.execute(
    `INSERT INTO print_job
    (id, job_no, label_type, candidate_record_id, requested_by, copies, status, expires_at, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NOW() + INTERVAL 1 DAY, ?)`,
    [id, `PROGRESS-${id}`, labelType, candidateId, actorId, copies, status, sent ? new Date() : null],
  );
}
