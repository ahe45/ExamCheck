import { randomUUID } from "node:crypto";
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

it.each(["ADMISSION", "BUILDING"] as const)(
  "deletes candidate and scope history without resetting first in %s mode",
  async (classificationMethod) => {
    const developer = new DeveloperSettingsService(harness.pool, new MutationAuditRepository());
    await developer.updateHistoryResetPassword("delete-secret", user);
    await harness.pool.execute("UPDATE system_profile SET classification_method = ? WHERE id = 1", [
      classificationMethod,
    ]);
    const removed = await seedDeletionHistory(classificationMethod, 1);
    const retained = await seedDeletionHistory(classificationMethod, 2);

    const operations = new PseudonymsService(harness.pool);
    try {
      await expect(
        operations.deleteAdmission(
          { admissionName: removed.scope, password: "delete-secret" },
          { ...user, classificationMethod },
        ),
      ).resolves.toMatchObject({ deletedCandidateCount: 1, deletedSettingCount: 1 });

      for (const [table, column, idKey] of [
        ["candidate_record", "id", "candidateId"],
        ["candidate_photo", "candidate_record_id", "candidateId"],
        ["pseudonym_setting", "id", "settingId"],
        ["print_job", "id", "jobId"],
        ["print_job_payload", "print_job_id", "jobId"],
      ] as const) {
        const [rows] = await harness.pool.execute<RowDataPacket[]>(
          `SELECT ${column} AS recordId FROM ${table} WHERE ${column} IN (?, ?)`,
          [removed[idKey], retained[idKey]],
        );
        expect(rows, table).toEqual([{ recordId: retained[idKey] }]);
      }

      const [history] = await harness.pool.execute<RowDataPacket[]>(
        "SELECT event_type AS eventType, request_id AS requestId FROM audit_log WHERE request_id IN (?, ?) ORDER BY event_type",
        [removed.jobId, retained.jobId],
      );
      expect(history.map(({ eventType }) => eventType)).toEqual([
        "ADMISSION_DELETED",
        "CANDIDATE_UPDATED",
        "OPERATION_HISTORY_RESET",
        "PRINT_JOB_SENT",
        "PSEUDONYM_SETTING_UPDATED",
      ]);
      expect(history.every(({ requestId }) => requestId === retained.jobId)).toBe(true);
      const [deletion] = await harness.pool.query<RowDataPacket[]>(
        `SELECT JSON_VALUE(details, '$.admissionName') AS scope, JSON_VALUE(details, '$.deletedCandidateCount') AS count
         FROM audit_log WHERE event_type = 'ADMISSION_DELETED' ORDER BY id DESC LIMIT 1`,
      );
      expect(deletion).toEqual([{ scope: null, count: "1" }]);
    } finally {
      await harness.pool.execute("UPDATE system_profile SET classification_method = 'ADMISSION' WHERE id = 1");
    }
  },
);

async function seedDeletionHistory(classificationMethod: "ADMISSION" | "BUILDING", index: number) {
  const jobId = randomUUID();
  const fixtureAdmission = classificationMethod === "BUILDING" ? "공통 전형" : `삭제 검증 전형 ${index}`;
  const [candidate] = await harness.pool.execute<ResultSetHeader>(
    `INSERT INTO candidate_record (examinee_no, name, exam_name, admission, exam_date, start_time, period_name,
       building_name, unit_name, room_name, label_barcode)
     VALUES (?, '삭제 검증 수험생', ?, ?, '2038-05-17', '09:00', '1교시', ?, '검증 단위', '101호', ?)`,
    [jobId, examName, fixtureAdmission, `삭제 검증 건물 ${index}`, jobId],
  );
  const candidateId = candidate.insertId;
  const [scopeRows] = await harness.pool.execute<RowDataPacket[]>(
    "SELECT operation_scope AS scope FROM operation_candidate_record WHERE id = ?",
    [candidateId],
  );
  const scope = String(scopeRows[0]!.scope);
  const [setting] = await harness.pool.execute<ResultSetHeader>(
    `INSERT INTO pseudonym_setting (exam_name, admission_name, range_start, range_end, display_width, next_sequence, updated_by)
     VALUES (?, ?, 1000, 1999, 4, 1000, ?)`,
    [examName, scope, user.id],
  );
  const settingId = setting.insertId;
  await harness.pool.execute(
    `INSERT INTO candidate_photo (candidate_record_id, file_name, mime_type, content, content_hash)
     VALUES (?, 'photo.png', 'image/png', 'photo fixture', SHA2('photo fixture', 256))`,
    [candidateId],
  );
  await harness.pool.execute(
    `INSERT INTO print_job (id, job_no, label_type, business_ref, candidate_record_id, requested_by, status, expires_at, sent_at)
     VALUES (?, ?, 'PSEUDONYM_LABEL', ?, ?, ?, 'SENT', NOW(3), NOW(3))`,
    [jobId, jobId, jobId, candidateId, user.id],
  );
  await harness.pool.execute("INSERT INTO print_job_payload (print_job_id, payload) VALUES (?, 'label fixture')", [
    jobId,
  ]);
  await harness.pool.execute(
    `INSERT INTO audit_log (request_id, event_type, print_job_id, details) VALUES
       (?, 'PRINT_JOB_SENT', ?, JSON_OBJECT('status', 'SENT')),
       (?, 'CANDIDATE_UPDATED', NULL, JSON_OBJECT('candidateRecordId', ?)),
       (?, 'OPERATION_HISTORY_RESET', NULL, JSON_OBJECT('admissionName', ?)),
       (?, 'PSEUDONYM_SETTING_UPDATED', NULL, JSON_OBJECT('settingId', ?)),
       (?, 'ADMISSION_DELETED', NULL, JSON_OBJECT('admissionName', ?))`,
    [jobId, jobId, jobId, candidateId, jobId, scope, jobId, settingId, jobId, scope],
  );
  return { candidateId, jobId, scope, settingId };
}

it("resets operation history and deletes exam data across classifications while preserving the installation", async () => {
  const audit = new MutationAuditRepository();
  const developer = new DeveloperSettingsService(harness.pool, audit);
  const operations = new PseudonymsService(harness.pool);
  const developerUser = { ...user, role: "DEVELOPER" as const };
  await developer.updateHistoryResetPassword("global-secret", developerUser);
  const { candidateId, settingId, jobId, scope } = await seedDeletionHistory("ADMISSION", 3);
  await harness.pool.execute("UPDATE pseudonym_setting SET next_sequence = 1001 WHERE id = ?", [settingId]);
  await harness.pool.execute("UPDATE candidate_record SET temporary_no = '1000' WHERE id = ?", [candidateId]);
  await harness.pool.execute(`INSERT INTO user_admission_assignment (user_id, admission_name) VALUES (?, ?)`, [
    user.id,
    scope,
  ]);
  await harness.pool.execute(
    `INSERT INTO pseudonym_time_range
      (setting_id, exam_date, exam_time, range_start, range_end, display_width, next_sequence, updated_by, schedule_key)
     VALUES (?, '2038-05-17', '09:00', 1000, 1999, 4, 1001, ?, SHA2('global-range-fixture', 256))`,
    [settingId, user.id],
  );
  await harness.pool.execute(
    `INSERT INTO print_job (id, job_no, label_type, requested_by, status, expires_at)
     VALUES (?, ?, 'PSEUDONYM_LABEL', ?, 'READY', DATE_ADD(NOW(3), INTERVAL 1 MINUTE))`,
    [candidateId.toString(), "LEGACY-ORPHAN-FIXTURE", user.id],
  );

  const reset = { action: "reset", confirmation: "전체 초기화", password: "global-secret" } as const;
  const remove = { action: "delete", confirmation: "전체 삭제", password: "global-secret" } as const;
  const sessionId = randomUUID();
  await harness.pool.execute(
    `INSERT INTO candidate_upload_session (id, owner_id, kind, status, file_name, checksum, result_json, expires_at)
     VALUES (?, ?, 'CANDIDATE_EXPORT', 'QUEUED', 'test.xlsx', SHA2('export fixture', 256), '{}', DATE_ADD(NOW(3), INTERVAL 1 MINUTE))`,
    [sessionId, user.id],
  );
  const installation = await installedCounts();
  await expect(operations.maintainExamData({ ...remove, confirmation: "전체 초기화" }, developerUser)).rejects.toThrow(
    "확인 문구",
  );
  await expect(operations.maintainExamData({ ...remove, password: "wrong-password" }, developerUser)).rejects.toThrow(
    "비밀번호가 올바르지",
  );
  await expect(operations.maintainExamData(remove, developerUser)).rejects.toThrow("내보내기가 진행 중");
  await harness.pool.execute("UPDATE candidate_upload_session SET status = 'SUCCEEDED' WHERE id = ?", [sessionId]);
  await expect(operations.maintainExamData(reset, developerUser)).rejects.toThrow("진행 중인 라벨 출력");
  await harness.pool.execute("UPDATE print_job SET status = 'SENT' WHERE job_no = 'LEGACY-ORPHAN-FIXTURE'");

  await expect(operations.maintainExamData(reset, developerUser)).resolves.toEqual({ completed: true });
  const resetState = await snapshot();
  expect(resetState.candidates.some(({ id }) => id === candidateId)).toBe(true);
  expect(resetState.assignments).toEqual([]);
  expect(resetState.operations).toEqual([]);
  const [resetRows] = await harness.pool.execute<RowDataPacket[]>(
    `SELECT ps.next_sequence AS settingCursor, r.next_sequence AS rangeCursor, pj.status, pj.sent_at AS sentAt,
            cr.temporary_no AS preassignedNumber
     FROM pseudonym_setting ps JOIN pseudonym_time_range r ON r.setting_id = ps.id
     JOIN print_job pj ON pj.id = ? JOIN candidate_record cr ON cr.id = pj.candidate_record_id WHERE ps.id = ?`,
    [jobId, settingId],
  );
  expect(resetRows).toEqual([
    { settingCursor: 1000, rangeCursor: 1000, status: "CANCELLED", sentAt: null, preassignedNumber: "1000" },
  ]);

  await expect(operations.maintainExamData(remove, developerUser)).resolves.toEqual({ completed: true });
  for (const table of [
    "candidate_record",
    "candidate_photo",
    "print_job",
    "print_job_payload",
    "pseudonym_setting",
    "pseudonym_time_range",
    "user_admission_assignment",
  ]) {
    const [entries] = await harness.pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM ${table}`);
    expect(entries[0]?.count, table).toBe(0);
  }
  const [relatedAudit] = await harness.pool.execute<RowDataPacket[]>(
    "SELECT id FROM audit_log WHERE request_id = ? OR event_type = 'EXAM_DATA_RESET'",
    [jobId],
  );
  expect(relatedAudit).toEqual([]);
  const [grants] = await harness.pool.execute<RowDataPacket[]>(
    "SELECT scope_key AS scope FROM user_classification_assignment WHERE user_id = ? AND classification_method = 'ADMISSION'",
    [user.id],
  );
  expect(grants).toContainEqual({ scope: "!" });
  const [sessions] = await harness.pool.execute<RowDataPacket[]>(
    `SELECT file_name AS name, result_json AS result, (expires_at <= NOW(3)) AS expired FROM candidate_upload_session WHERE id = ?`,
    [sessionId],
  );
  expect(sessions).toEqual([{ name: "", result: null, expired: 1 }]);
  expect(await installedCounts()).toEqual(installation);
});

async function installedCounts() {
  const [rows] = await harness.pool.query<RowDataPacket[]>(
    `SELECT (SELECT COUNT(*) FROM app_user) AS accounts, (SELECT COUNT(*) FROM label_template) AS labels,
            (SELECT COUNT(*) FROM form_template) AS forms, (SELECT COUNT(*) FROM system_profile) AS profiles`,
  );
  return rows;
}
