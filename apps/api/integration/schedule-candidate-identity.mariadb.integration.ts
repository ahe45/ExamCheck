import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../src/auth/auth.types.js";
import { resolveAppConfig } from "../src/config/app-config.js";
import { ExamineesService, type OperationScheduleScope } from "../src/examinees/examinees.service.js";
import { PrintJobsService } from "../src/print-jobs/print-jobs.service.js";
import { PseudonymsService } from "../src/pseudonyms/pseudonyms.service.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

const examName = "IT 일정별 수험생 시험";
const admissionName = "IT 일정별 전형";
const examineeNo = "IT-SCHEDULE-IDENTITY-01";
const schedules = [
  {
    date: "2039-06-11",
    time: "09:00",
    periodName: "IT 오전 교시",
    roomName: "오전 101호",
    seatNo: "11",
    preassignedNumber: "8101",
    photo: Buffer.from("morning-photo"),
  },
  {
    date: "2039-06-11",
    time: "13:00",
    periodName: "IT 오후 교시",
    roomName: "오후 202호",
    seatNo: "22",
    preassignedNumber: "8201",
    photo: Buffer.from("afternoon-photo"),
  },
] as const;

let harness: MariaDbIntegrationHarness;
let actor: AuthenticatedUser;
let examinees: ExamineesService;
let pseudonyms: PseudonymsService;
let printJobs: PrintJobsService;
let candidateRecordIds: number[];

beforeAll(async () => {
  harness = await createMariaDbIntegrationHarness();
  actor = await readSystemUser();
  candidateRecordIds = await seedScheduleCandidates();
  examinees = new ExamineesService(harness.pool, resolveAppConfig({ DEFAULT_EXAM_NAME: examName }));
  pseudonyms = new PseudonymsService(harness.pool);
  printJobs = new PrintJobsService(harness.pool, resolveAppConfig({ PRINT_JOB_EXPIRY_SECONDS: "300" }));

  await harness.pool.execute(
    "UPDATE system_profile SET examinee_no_uniqueness = 'SCHEDULE', pseudonym_no_uniqueness = 'SCHEDULE' WHERE id = 1",
  );
  await pseudonyms.updateSetting(
    {
      expectedVersion: 0,
      examName,
      admissionName,
      rangeStart: 8101,
      rangeEnd: 8201,
      assignmentMethod: "PREASSIGNED",
      autoDrawEnabled: false,
      autoDrawDelaySeconds: 3,
      printPreassignedLabel: true,
      autoAssignAbsenteesOnClose: false,
      deleteAbsenteeInfoOnReopen: false,
      useCandidatePhotos: true,
      enableBulkDraw: false,
      ranges: [],
    },
    actor,
  );
  await harness.pool.execute(
    `INSERT INTO label_template (code, version, name, zpl_template, active, created_by)
     VALUES ('PSEUDONYM_LABEL', 99, '일정별 원본 검증',
       '^XA^FD{{PSEUDONYM_NO}}|{{EXAMINEE_NO}}|{{ROOM_NAME}}|{{SEAT_NO}}|{{EXAM_DATE}}^FS^XZ', TRUE, ?)`,
    [actor.id],
  );
});

afterAll(async () => {
  if (harness) await harness.cleanup();
});

describe("schedule-scoped candidate identity MariaDB integration", () => {
  it("uses the exact candidate_record for roster, lookup and photo data", async () => {
    for (const [index, schedule] of schedules.entries()) {
      const scope = operationScope(schedule);
      const roster = await examinees.listRoster(scope, actor);
      const lookup = await examinees.lookupByNumber(examineeNo, scope, actor);
      const photo = await examinees.findPhotoByNumber(examineeNo, scope, actor);

      expect(roster).toHaveLength(1);
      expect(roster[0]).toMatchObject({
        id: candidateRecordIds[index],
        examineeNo,
        name: "일정별 동일 수험생",
        birthDate: "2001-02-03",
        examName,
        roomName: schedule.roomName,
        seatNo: schedule.seatNo,
        preassignedNumber: schedule.preassignedNumber,
      });
      expect(lookup).toMatchObject({
        status: "CURRENT",
        examinee: {
          id: candidateRecordIds[index],
          name: "일정별 동일 수험생",
          roomName: schedule.roomName,
          seatNo: schedule.seatNo,
          preassignedNumber: schedule.preassignedNumber,
        },
      });
      expect(photo.content.equals(schedule.photo)).toBe(true);
    }

    const otherSchedule = await examinees.lookupByNumber(
      examineeNo,
      { date: "2039-06-12", time: "09:00", periodName: "없는 교시", admissionName },
      actor,
    );
    expect(otherSchedule).toMatchObject({
      status: "OTHER_SCHEDULE",
      name: "일정별 동일 수험생",
      schedules: [
        { periodName: schedules[0].periodName, roomName: schedules[0].roomName },
        { periodName: schedules[1].periodName, roomName: schedules[1].roomName },
      ],
    });
  });

  it("binds assignment and print payloads to each candidate_record schedule", async () => {
    for (const [index, schedule] of schedules.entries()) {
      const assignment = await pseudonyms.assign(
        {
          examName,
          examineeNo,
          mode: "PREASSIGNED",
          examDate: schedule.date,
          examTime: schedule.time,
          periodName: schedule.periodName,
          admissionName,
        },
        actor,
      );
      expect(assignment).toMatchObject({
        examineeNo,
        examineeName: "일정별 동일 수험생",
        examName,
        pseudonymNumber: schedule.preassignedNumber,
      });

      const job = await printJobs.create(
        {
          idempotencyKey: randomUUID(),
          examineeNo,
          examName,
          workstationCode: "WS-DEV-001",
          copies: 1,
          examDate: schedule.date,
          examTime: schedule.time,
          periodName: schedule.periodName,
          admissionName,
        },
        actor,
      );
      expect(job.payload).toBe(
        `^XA^FD${schedule.preassignedNumber}|${examineeNo}|${schedule.roomName}|${schedule.seatNo}|${schedule.date}^FS^XZ`,
      );

      const [rows] = await harness.pool.execute<Array<RowDataPacket & { candidateRecordId: number }>>(
        `SELECT candidate_record_id AS candidateRecordId
         FROM pseudonym_assignment
         WHERE exam_name = ? AND admission_name = ? AND pseudonym_no = ?`,
        [examName, admissionName, schedule.preassignedNumber],
      );
      expect(Number(rows[0]?.candidateRecordId)).toBe(candidateRecordIds[index]);
    }
  });
});

function operationScope(schedule: (typeof schedules)[number]): OperationScheduleScope {
  return {
    date: schedule.date,
    time: schedule.time,
    periodName: schedule.periodName,
    admissionName,
  };
}

async function readSystemUser(): Promise<AuthenticatedUser> {
  const [rows] = await harness.pool.execute<Array<RowDataPacket & { id: number }>>(
    "SELECT id FROM app_user WHERE login_id = 'system' LIMIT 1",
  );
  if (!rows[0]) throw new Error("Fresh migration did not create the system user.");
  return { id: Number(rows[0].id), loginId: "system", role: "DEVELOPER", admissionNames: [] };
}

async function seedScheduleCandidates(): Promise<number[]> {
  await harness.pool.execute(
    `INSERT INTO examinee
      (examinee_no, name, exam_name, exam_date, room_name, seat_no, label_barcode,
       preassigned_pseudonym_no, status)
     VALUES (?, '오래된 레거시 이름', '오래된 레거시 시험명', '2038-01-01',
       '오래된 레거시 고사실', '99', ?, '9999', 'ACTIVE')`,
    [examineeNo, `EX-${examineeNo}`],
  );

  const ids: number[] = [];
  for (const [index, schedule] of schedules.entries()) {
    const [candidate] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO candidate_record
        (designated_sort, admission, unit_name, major, exam_date, start_time,
         period_name, building_name, room_name, examinee_no, temporary_no, name, birth_date)
       VALUES (?, ?, '일정별 모집단위', '일정별 전공', ?, ?, ?, '일정별 건물', ?, ?, ?,
         '일정별 동일 수험생', '2001-02-03')`,
      [
        schedule.seatNo,
        admissionName,
        schedule.date,
        schedule.time,
        schedule.periodName,
        schedule.roomName,
        examineeNo,
        schedule.preassignedNumber,
      ],
    );
    const candidateRecordId = Number(candidate.insertId);
    ids.push(candidateRecordId);
    await harness.pool.execute(
      `INSERT INTO candidate_photo (candidate_record_id, file_name, mime_type, content, content_hash)
       VALUES (?, ?, 'image/png', ?, ?)`,
      [candidateRecordId, `${examineeNo}-${index}.png`, schedule.photo, String(index).padStart(64, "0")],
    );
  }
  return ids;
}
