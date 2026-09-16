import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { AuthenticatedUser } from "../src/auth/auth.types.js";
import { hashPassword } from "../src/auth/password.js";
import { MutationAuditRepository } from "../src/common/audit/mutation-audit.repository.js";
import { DeveloperSettingsService } from "../src/developer-settings/developer-settings.service.js";
import { PseudonymsService } from "../src/pseudonyms/pseudonyms.service.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

let harness: MariaDbIntegrationHarness;
let user: AuthenticatedUser;
const admissionName = "비밀번호 검증 전형";
const examName = "비밀번호 검증 시험";
const schedules = [{ examDate: "2038-05-17", examTime: "09:00", periodName: "1교시" }];

beforeAll(async () => {
  harness = await createMariaDbIntegrationHarness();
  const [users] = await harness.pool.query<RowDataPacket[]>("SELECT id FROM app_user WHERE login_id = 'system'");
  user = { id: Number(users[0]!.id), loginId: "system", role: "ADMIN", admissionNames: [] };
  await harness.pool.execute("UPDATE app_user SET password_hash = ? WHERE id = ?", [
    await hashPassword("login-secret"),
    user.id,
  ]);
  for (const [index, admission] of [admissionName, "보존할 다른 전형"].entries()) {
    const [candidate] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO candidate_record (examinee_no, name, exam_name, admission, exam_date, start_time, period_name, unit_name, building_name, room_name, label_barcode)
       VALUES (?, '검증 수험생', ?, ?, '2038-05-17', '09:00', '1교시', '검증 단위', '본관', '101호', ?)`,
      [`PASSWORD-${index}`, examName, admission, `PASSWORD-BC-${index}`],
    );
    await harness.pool.execute(
      `INSERT INTO pseudonym_assignment (candidate_record_id, exam_name, admission_name, uniqueness_scope_key, pseudonym_no, assignment_mode, assigned_by)
       VALUES (?, ?, ?, '', ?, 'SEQUENTIAL', ?)`,
      [candidate.insertId, examName, admission, String(1001 + index), user.id],
    );
    await harness.pool.execute(
      `INSERT INTO pseudonym_operation (exam_name, admission_name, exam_date, exam_time, period_name, closed)
       VALUES (?, ?, '2038-05-17', '09:00', '1교시', TRUE)`,
      [examName, admission],
    );
  }
});
afterAll(async () => {
  if (harness) await harness.cleanup();
});

async function snapshot() {
  const [candidates] = await harness.pool.query<RowDataPacket[]>(
    "SELECT id, admission FROM candidate_record ORDER BY id",
  );
  const [assignments] = await harness.pool.query<RowDataPacket[]>(
    "SELECT id, pseudonym_no FROM pseudonym_assignment ORDER BY id",
  );
  const [operations] = await harness.pool.query<RowDataPacket[]>(
    "SELECT id, closed FROM pseudonym_operation ORDER BY id",
  );
  return { candidates, assignments, operations };
}

it("uses the developer reset password for both admission actions and leaves data unchanged on rejected passwords", async () => {
  const operations = new PseudonymsService(harness.pool);
  const developer = new DeveloperSettingsService(harness.pool, new MutationAuditRepository());
  const reset = (password: string) =>
    operations.resetAdmissionOperations({ examName, admissionName, schedules, password }, user);
  const remove = (password: string) => operations.deleteAdmission({ admissionName, password }, user);
  const initial = await snapshot();
  for (const action of [reset, remove]) await expect(action("reset-secret")).rejects.toThrow("먼저 설정");
  expect(await snapshot()).toEqual(initial);
  await developer.updateHistoryResetPassword("reset-secret", user);
  for (const action of [reset, remove]) {
    for (const password of ["", "wrong-secret", "login-secret"]) {
      await expect(action(password)).rejects.toThrow("초기화 비밀번호가 올바르지");
      expect(await snapshot()).toEqual(initial);
    }
  }
  expect(await reset("reset-secret")).toMatchObject({
    resetScheduleCount: 1,
    deletedAssignmentCount: 1,
    deletedOperationCount: 1,
  });
  const resetState = await snapshot();
  expect(resetState.candidates).toEqual(initial.candidates);
  expect(resetState.assignments).toHaveLength(initial.assignments.length - 1);
  await developer.updateHistoryResetPassword("new-reset-secret", user);
  await expect(remove("reset-secret")).rejects.toThrow("초기화 비밀번호가 올바르지");
  expect(await snapshot()).toEqual(resetState);
  expect(await remove("new-reset-secret")).toMatchObject({ deleted: true, deletedCandidateCount: 1 });
  const finalState = await snapshot();
  expect(finalState.candidates).toEqual(initial.candidates.filter((row) => row.admission !== admissionName));
  expect(finalState.assignments).toEqual(resetState.assignments);
  expect(finalState.operations).toEqual(resetState.operations);
});
