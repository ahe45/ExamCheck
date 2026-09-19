import { createHash } from "node:crypto";
import mysql from "mysql2/promise";

const databaseName = process.env.E2E_DB_NAME;
if (!databaseName || databaseName !== process.env.DB_NAME || !/^examcheck_e2e_[0-9a-f]{32}$/.test(databaseName)) {
  throw new Error("E2E fixtures may only be written to the isolated nonce database.");
}

const DEFAULT_EXAM_NAME = "2026년도 자격시험";
const SMOKE_ADMISSION = "CI-E2E-SMOKE-전형";
const SETTINGS_ADMISSION = "CI-E2E-SETTINGS-전형";
const WORKFLOW_ADMISSION = "CI-E2E-WORKFLOW-전형";

const candidates = [
  candidate({
    designatedSort: "CI-E2E-001",
    admission: SMOKE_ADMISSION,
    admissionCode: "CI-E2E-SMOKE-ADM",
    date: "2026-10-30",
    time: "10:00",
    endTime: "11:00",
    period: "CI-E2E-SMOKE-1교시",
    periodCode: "CI-E2E-SMOKE-P1",
    examineeNo: "CI-E2E-SMOKE-001",
    name: "CI-E2E-가상수험생-SMOKE",
    unit: "CI-E2E-SMOKE-모집단위",
    major: "CI-E2E-SMOKE-전공",
    building: "CI-E2E-SMOKE-고사건물",
    room: "CI-E2E-SMOKE-고사실",
  }),
  candidate({
    designatedSort: "CI-E2E-101",
    admission: SETTINGS_ADMISSION,
    admissionCode: "CI-E2E-SETTINGS-ADM",
    date: "2026-10-31",
    time: "09:00",
    endTime: "10:00",
    period: "CI-E2E-SETTINGS-1교시",
    periodCode: "CI-E2E-SETTINGS-P1",
    examineeNo: "CI-E2E-SETTINGS-001",
    name: "CI-E2E-가상수험생-SETTINGS",
    unit: "CI-E2E-SETTINGS-모집단위",
    major: "CI-E2E-SETTINGS-전공",
    building: "CI-E2E-SETTINGS-고사건물",
    room: "CI-E2E-SETTINGS-고사실",
  }),
  candidate({
    designatedSort: "CI-E2E-201",
    admission: WORKFLOW_ADMISSION,
    admissionCode: "CI-E2E-WORKFLOW-ADM",
    date: "2026-11-01",
    time: "10:00",
    endTime: "11:00",
    period: "CI-E2E-WORKFLOW-1교시",
    periodCode: "CI-E2E-WORKFLOW-P1",
    examineeNo: "CI-E2E-WORKFLOW-001",
    name: "CI-E2E-가상수험생-A",
    unit: "CI-E2E-WORKFLOW-모집단위",
    major: "CI-E2E-WORKFLOW-전공",
    building: "CI-E2E-WORKFLOW-고사건물-A",
    room: "CI-E2E-WORKFLOW-고사실-A",
  }),
  candidate({
    designatedSort: "CI-E2E-202",
    admission: WORKFLOW_ADMISSION,
    admissionCode: "CI-E2E-WORKFLOW-ADM",
    date: "2026-11-01",
    time: "10:00",
    endTime: "11:00",
    period: "CI-E2E-WORKFLOW-1교시",
    periodCode: "CI-E2E-WORKFLOW-P1",
    examineeNo: "CI-E2E-WORKFLOW-002",
    name: "CI-E2E-가상수험생-B",
    unit: "CI-E2E-WORKFLOW-모집단위",
    major: "CI-E2E-WORKFLOW-전공",
    building: "CI-E2E-WORKFLOW-고사건물-A",
    room: "CI-E2E-WORKFLOW-고사실-A",
  }),
  candidate({
    designatedSort: "CI-E2E-203",
    admission: WORKFLOW_ADMISSION,
    admissionCode: "CI-E2E-WORKFLOW-ADM",
    date: "2026-11-01",
    time: "13:00",
    endTime: "14:00",
    period: "CI-E2E-WORKFLOW-2교시",
    periodCode: "CI-E2E-WORKFLOW-P2",
    examineeNo: "CI-E2E-WORKFLOW-003",
    name: "CI-E2E-가상수험생-C",
    unit: "CI-E2E-WORKFLOW-모집단위",
    major: "CI-E2E-WORKFLOW-전공",
    building: "CI-E2E-WORKFLOW-고사건물-B",
    room: "CI-E2E-WORKFLOW-고사실-B",
  }),
];

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || "3306"),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: databaseName,
  charset: "utf8mb4",
});

try {
  await connection.beginTransaction();
  for (const fixture of candidates) await insertCandidate(connection, fixture);

  for (const admission of [SMOKE_ADMISSION, SETTINGS_ADMISSION, WORKFLOW_ADMISSION]) {
    await connection.execute(
      `INSERT IGNORE INTO user_admission_assignment (user_id, admission_name)
       SELECT id, ? FROM app_user WHERE login_id = '가번호' AND enabled = TRUE`,
      [admission],
    );
  }

  await upsertSetting(connection, {
    admission: SMOKE_ADMISSION,
    rangeStart: 9001,
    rangeEnd: 9001,
    useCandidatePhotos: false,
    ranges: [rangeFor(candidates[0], 9001, 9001)],
  });
  await upsertSetting(connection, {
    admission: SETTINGS_ADMISSION,
    rangeStart: 8001,
    rangeEnd: 8001,
    useCandidatePhotos: true,
    ranges: [rangeFor(candidates[1], 8001, 8001)],
  });
  await upsertSetting(connection, {
    admission: WORKFLOW_ADMISSION,
    rangeStart: 7001,
    rangeEnd: 7101,
    useCandidatePhotos: false,
    ranges: [rangeFor(candidates[2], 7001, 7002), rangeFor(candidates[4], 7101, 7101)],
  });
  await connection.commit();
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}

function candidate(input) {
  return {
    ...input,
    track: "CI-E2E-트랙",
    series: "CI-E2E-계열",
    seriesCode: "CI-E2E-SERIES",
    unitCode: `${input.admissionCode}-UNIT`,
    majorCode: `${input.admissionCode}-MAJOR`,
    buildingCode: `${input.periodCode}-BUILDING`,
    roomCode: `${input.periodCode}-ROOM`,
    birthDate: "2000-01-01",
  };
}

function rangeFor(fixture, rangeStart, rangeEnd) {
  return {
    date: fixture.date,
    time: fixture.time,
    period: fixture.period,
    admission: fixture.admission,
    unit: fixture.unit,
    major: fixture.major,
    building: fixture.building,
    room: fixture.room,
    rangeStart,
    rangeEnd,
  };
}

async function insertCandidate(executor, fixture) {
  await executor.execute(
    `INSERT INTO candidate_record (
       designated_sort, track, admission, admission_code, series, series_code,
       unit_name, unit_code, major, major_code, exam_date, start_time, end_time,
       period_name, period_code, building_name, building_code, room_name, room_code,
       examinee_no, temporary_no, name, birth_date, group_name, exam_name, label_barcode, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, '', ?, ?, 'ACTIVE')
     ON DUPLICATE KEY UPDATE
       designated_sort = VALUES(designated_sort), admission = VALUES(admission),
       unit_name = VALUES(unit_name), major = VALUES(major), building_name = VALUES(building_name),
       room_name = VALUES(room_name), name = VALUES(name), birth_date = VALUES(birth_date)`,
    [
      fixture.designatedSort,
      fixture.track,
      fixture.admission,
      fixture.admissionCode,
      fixture.series,
      fixture.seriesCode,
      fixture.unit,
      fixture.unitCode,
      fixture.major,
      fixture.majorCode,
      fixture.date,
      fixture.time,
      fixture.endTime,
      fixture.period,
      fixture.periodCode,
      fixture.building,
      fixture.buildingCode,
      fixture.room,
      fixture.roomCode,
      fixture.examineeNo,
      fixture.name,
      fixture.birthDate,
      DEFAULT_EXAM_NAME,
      `CI-E2E-BARCODE-${fixture.examineeNo}`,
    ],
  );
}

async function upsertSetting(executor, input) {
  await executor.execute(
    `INSERT INTO pseudonym_setting (
       exam_name, admission_name, range_start, range_end, next_sequence, assignment_method,
       auto_draw_enabled, auto_draw_delay_seconds, print_preassigned_label,
       auto_assign_absentees_on_close, delete_absentee_info_on_reopen,
       use_candidate_photos, enable_bulk_draw, active, updated_by, version, display_width
     )
     SELECT ?, ?, ?, ?, ?, 'SEQUENTIAL', FALSE, 3, FALSE, FALSE, FALSE, ?, FALSE, TRUE, id, 1, 4
     FROM app_user WHERE login_id = 'system'
     ON DUPLICATE KEY UPDATE
       range_start = VALUES(range_start), range_end = VALUES(range_end),
       next_sequence = VALUES(next_sequence), assignment_method = 'SEQUENTIAL',
       auto_draw_enabled = FALSE, auto_draw_delay_seconds = 3,
       print_preassigned_label = FALSE, auto_assign_absentees_on_close = FALSE,
       delete_absentee_info_on_reopen = FALSE, use_candidate_photos = VALUES(use_candidate_photos),
       enable_bulk_draw = FALSE, active = TRUE, version = 1`,
    [DEFAULT_EXAM_NAME, input.admission, input.rangeStart, input.rangeEnd, input.rangeStart, input.useCandidatePhotos],
  );
  const [[setting]] = await executor.execute(
    `SELECT id FROM pseudonym_setting WHERE exam_name = ? AND admission_name = ? LIMIT 1`,
    [DEFAULT_EXAM_NAME, input.admission],
  );
  if (!setting?.id) throw new Error(`Could not create isolated setting fixture for ${input.admission}.`);
  await executor.execute("DELETE FROM pseudonym_time_range WHERE setting_id = ?", [setting.id]);
  for (const range of input.ranges) {
    const scheduleKey = createHash("sha256")
      .update(
        [
          range.date,
          range.time,
          range.period,
          range.admission,
          range.unit,
          range.major,
          range.building,
          range.room,
        ].join("|"),
      )
      .digest("hex");
    await executor.execute(
      `INSERT INTO pseudonym_time_range (
         setting_id, exam_date, exam_time, period_name, admission, unit_name, major,
         building_name, room_name, schedule_key, range_start, range_end, next_sequence, updated_by, display_width
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, id, 4
       FROM app_user WHERE login_id = 'system'`,
      [
        setting.id,
        range.date,
        range.time,
        range.period,
        range.admission,
        range.unit,
        range.major,
        range.building,
        range.room,
        scheduleKey,
        range.rangeStart,
        range.rangeEnd,
        range.rangeStart,
      ],
    );
  }
}
