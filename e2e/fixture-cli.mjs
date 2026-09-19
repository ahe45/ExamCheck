import { createHash } from "node:crypto";
import mysql from "mysql2/promise";

const DEFAULT_EXAM_NAME = "2026년도 자격시험";
const SETTINGS_ADMISSION = "CI-E2E-SETTINGS-전형";
const WORKFLOW_ADMISSION = "CI-E2E-WORKFLOW-전형";
const ACCOUNT_LOGIN_IDS = ["CI-E2E-account", "CI-E2E-account-updated"];
const command = process.argv[2];
const databaseName = process.env.E2E_DB_NAME;

if (!databaseName || databaseName !== process.env.DB_NAME || !/^examcheck_e2e_[0-9a-f]{32}$/.test(databaseName)) {
  throw new Error("Workflow fixture reset may only modify the isolated nonce database.");
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || "3306"),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: databaseName,
  charset: "utf8mb4",
});

try {
  await assertOwnedDatabase(connection, databaseName);
  if (command === "reset-account") await resetAccount(connection);
  else if (command === "reset-settings") await resetSettings(connection);
  else if (command === "reset-developer") await resetDeveloperPolicy(connection);
  else if (command === "reset-operation") await resetOperation(connection);
  else throw new Error(`Unknown E2E fixture command: ${command || "(missing)"}.`);
} finally {
  await connection.end();
}

async function assertOwnedDatabase(executor, expectedDatabaseName) {
  const [databaseRows] = await executor.query("SELECT DATABASE() AS currentDatabase");
  if (databaseRows.length !== 1 || databaseRows[0]?.currentDatabase !== expectedDatabaseName) {
    throw new Error(`Refusing to modify an unowned database: ${expectedDatabaseName}.`);
  }
  const [migrationRows] = await executor.query(
    "SELECT COUNT(*) AS migrationCount FROM schema_migration WHERE version LIKE '025_%'",
  );
  if (Number(migrationRows[0]?.migrationCount) !== 1) {
    throw new Error(`Fixture database is not at the expected migration baseline: ${expectedDatabaseName}.`);
  }
}

async function resetAccount(executor) {
  await executor.execute(
    `DELETE FROM app_user
     WHERE login_id IN (?, ?) AND login_id LIKE 'CI-E2E-%'`,
    ACCOUNT_LOGIN_IDS,
  );
}

async function resetSettings(executor) {
  await resetAdmissionSetting(executor, {
    admission: SETTINGS_ADMISSION,
    rangeStart: 8001,
    rangeEnd: 8001,
    useCandidatePhotos: true,
    clearOperation: false,
    ranges: [
      rangeFixture({
        admission: SETTINGS_ADMISSION,
        date: "2026-10-31",
        time: "09:00",
        period: "CI-E2E-SETTINGS-1교시",
        unit: "CI-E2E-SETTINGS-모집단위",
        major: "CI-E2E-SETTINGS-전공",
        building: "CI-E2E-SETTINGS-고사건물",
        room: "CI-E2E-SETTINGS-고사실",
        rangeStart: 8001,
        rangeEnd: 8001,
      }),
    ],
  });
}

async function resetDeveloperPolicy(executor) {
  await executor.execute(
    `UPDATE system_profile
     SET examinee_no_uniqueness = 'SYSTEM', pseudonym_no_uniqueness = 'ADMISSION'
     WHERE id = 1`,
  );
}

async function resetOperation(executor) {
  await resetAdmissionSetting(executor, {
    admission: WORKFLOW_ADMISSION,
    rangeStart: 7001,
    rangeEnd: 7101,
    useCandidatePhotos: false,
    clearOperation: true,
    ranges: [
      rangeFixture({
        admission: WORKFLOW_ADMISSION,
        date: "2026-11-01",
        time: "10:00",
        period: "CI-E2E-WORKFLOW-1교시",
        unit: "CI-E2E-WORKFLOW-모집단위",
        major: "CI-E2E-WORKFLOW-전공",
        building: "CI-E2E-WORKFLOW-고사건물-A",
        room: "CI-E2E-WORKFLOW-고사실-A",
        rangeStart: 7001,
        rangeEnd: 7002,
      }),
      rangeFixture({
        admission: WORKFLOW_ADMISSION,
        date: "2026-11-01",
        time: "13:00",
        period: "CI-E2E-WORKFLOW-2교시",
        unit: "CI-E2E-WORKFLOW-모집단위",
        major: "CI-E2E-WORKFLOW-전공",
        building: "CI-E2E-WORKFLOW-고사건물-B",
        room: "CI-E2E-WORKFLOW-고사실-B",
        rangeStart: 7101,
        rangeEnd: 7101,
      }),
    ],
  });
}

async function resetAdmissionSetting(executor, input) {
  await executor.beginTransaction();
  try {
    if (input.clearOperation) {
      await executor.execute(
        `DELETE pa FROM pseudonym_assignment pa
         INNER JOIN candidate_record cr ON cr.id = pa.candidate_record_id
         WHERE cr.admission = ?`,
        [input.admission],
      );
      await executor.execute("DELETE FROM pseudonym_operation WHERE exam_name = ? AND admission_name = ?", [
        DEFAULT_EXAM_NAME,
        input.admission,
      ]);
    }
    await executor.execute(
      `UPDATE pseudonym_setting ps
       INNER JOIN app_user actor ON actor.login_id = 'system'
       SET ps.range_start = ?, ps.range_end = ?, ps.next_sequence = ?,
           ps.assignment_method = 'SEQUENTIAL', ps.auto_draw_enabled = FALSE,
           ps.auto_draw_delay_seconds = 3, ps.print_preassigned_label = FALSE,
           ps.auto_assign_absentees_on_close = FALSE,
           ps.delete_absentee_info_on_reopen = FALSE, ps.use_candidate_photos = ?,
           ps.enable_bulk_draw = FALSE, ps.show_attendance_selection = TRUE,
           ps.active = TRUE, ps.updated_by = actor.id, ps.version = 1
       WHERE ps.exam_name = ? AND ps.admission_name = ?`,
      [
        input.rangeStart,
        input.rangeEnd,
        input.rangeStart,
        input.useCandidatePhotos,
        DEFAULT_EXAM_NAME,
        input.admission,
      ],
    );
    const [settings] = await executor.execute(
      "SELECT id FROM pseudonym_setting WHERE exam_name = ? AND admission_name = ? LIMIT 1",
      [DEFAULT_EXAM_NAME, input.admission],
    );
    const settingId = Number(settings[0]?.id);
    if (!Number.isSafeInteger(settingId) || settingId < 1) {
      throw new Error(`Missing isolated setting fixture for ${input.admission}.`);
    }
    await executor.execute("DELETE FROM pseudonym_time_range WHERE setting_id = ?", [settingId]);
    for (const range of input.ranges) await insertRange(executor, settingId, range);
    await executor.execute(
      `INSERT IGNORE INTO user_admission_assignment (user_id, admission_name)
       SELECT id, ? FROM app_user WHERE login_id = '가번호' AND enabled = TRUE`,
      [input.admission],
    );
    await executor.commit();
  } catch (error) {
    await executor.rollback();
    throw error;
  }
}

function rangeFixture(input) {
  return {
    ...input,
    scheduleKey: createHash("sha256")
      .update(
        [
          input.date,
          input.time,
          input.period,
          input.admission,
          input.unit,
          input.major,
          input.building,
          input.room,
        ].join("|"),
      )
      .digest("hex"),
  };
}

async function insertRange(executor, settingId, range) {
  await executor.execute(
    `INSERT INTO pseudonym_time_range (
       setting_id, exam_date, exam_time, period_name, admission, unit_name, major,
       building_name, room_name, schedule_key, range_start, range_end, next_sequence, display_width, updated_by
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 4, id
     FROM app_user WHERE login_id = 'system'`,
    [
      settingId,
      range.date,
      range.time,
      range.period,
      range.admission,
      range.unit,
      range.major,
      range.building,
      range.room,
      range.scheduleKey,
      range.rangeStart,
      range.rangeEnd,
      range.rangeStart,
    ],
  );
}
