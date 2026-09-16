import { ConflictException } from "@nestjs/common";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../src/auth/auth.types.js";
import { MutationAuditRepository } from "../src/common/audit/mutation-audit.repository.js";
import { DeveloperSettingsService } from "../src/developer-settings/developer-settings.service.js";
import { PseudonymsService } from "../src/pseudonyms/pseudonyms.service.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

let harness: MariaDbIntegrationHarness;
let actor: AuthenticatedUser;

const examName = "IT_UNIQUENESS_EXAM";
const admissionName = "IT 유일정책 전형";
const examineeNo = "IT-REUSE-01";
const schedules = [
  { examDate: "2037-05-10", examTime: "09:00", periodName: "IT 1교시", roomName: "IT-101" },
  { examDate: "2037-05-10", examTime: "13:00", periodName: "IT 2교시", roomName: "IT-201" },
];

beforeAll(async () => {
  harness = await createMariaDbIntegrationHarness();
  const [rows] = await harness.pool.execute<Array<RowDataPacket & { id: number }>>(
    "SELECT id FROM app_user WHERE login_id = 'system' LIMIT 1",
  );
  if (!rows[0]) throw new Error("Migration fixture did not create the system account.");
  actor = { id: Number(rows[0].id), loginId: "system", role: "DEVELOPER", admissionNames: [] };
});

afterAll(async () => {
  if (harness) await harness.cleanup();
});

describe("number uniqueness MariaDB integration", () => {
  it("supports schedule identities and blocks a narrower policy while conflicts remain", async () => {
    const developerSettings = new DeveloperSettingsService(harness.pool, new MutationAuditRepository());
    await developerSettings.update(profileInput("SCHEDULE", "SCHEDULE"), actor);
    await seedRepeatedExamineeNumber(harness.pool);

    const pseudonyms = new PseudonymsService(harness.pool);
    await pseudonyms.updateSetting(
      {
        expectedVersion: 0,
        examName,
        admissionName,
        rangeStart: 7001,
        rangeEnd: 7001,
        assignmentMethod: "MATCHING",
        autoDrawEnabled: false,
        autoDrawDelaySeconds: 3,
        printPreassignedLabel: false,
        autoAssignAbsenteesOnClose: false,
        deleteAbsenteeInfoOnReopen: false,
        useCandidatePhotos: true,
        enableBulkDraw: false,
        ranges: schedules.map((schedule) => ({
          date: schedule.examDate,
          time: schedule.examTime,
          period: schedule.periodName,
          admission: admissionName,
          unit: "IT 모집단위",
          major: "IT 전공",
          building: "IT관",
          room: schedule.roomName,
          rangeStart: 7001,
          rangeEnd: 7001,
        })),
      },
      actor,
    );

    for (const schedule of schedules) {
      const assigned = await pseudonyms.assign(
        {
          examineeNo,
          mode: "MANUAL",
          manualNumber: "7001",
          examDate: schedule.examDate,
          examTime: schedule.examTime,
          periodName: schedule.periodName,
          admissionName,
        },
        actor,
      );
      expect(assigned.pseudonymNumber).toBe("7001");
      expect(assigned.alreadyAssigned).toBe(false);
    }

    const [assignments] = await harness.pool.execute<
      Array<
        RowDataPacket & {
          assignmentCount: number;
          candidateCount: number;
          scopeCount: number;
        }
      >
    >(
      `SELECT COUNT(*) AS assignmentCount,
              COUNT(DISTINCT candidate_record_id) AS candidateCount,
              COUNT(DISTINCT uniqueness_scope_key) AS scopeCount
       FROM pseudonym_assignment WHERE exam_name = ? AND admission_name = ?`,
      [examName, admissionName],
    );
    expect(Number(assignments[0]?.assignmentCount)).toBe(2);
    expect(Number(assignments[0]?.candidateCount)).toBe(2);
    expect(Number(assignments[0]?.scopeCount)).toBe(2);

    const examineePolicyError = await captureError(developerSettings.update(profileInput("SYSTEM", "SCHEDULE"), actor));
    expect(examineePolicyError).toBeInstanceOf(ConflictException);
    expect(examineePolicyError.message).toContain("중복된 수험번호가 1개");
    expect(examineePolicyError.message).not.toContain(examineeNo);

    const pseudonymPolicyError = await captureError(
      developerSettings.update(profileInput("SCHEDULE", "ADMISSION"), actor),
    );
    expect(pseudonymPolicyError).toBeInstanceOf(ConflictException);
    expect(pseudonymPolicyError.message).toContain("중복된 가번호 조합이 1개");
    expect(pseudonymPolicyError.message).not.toContain("7001");

    const profile = await developerSettings.get();
    expect(profile.examineeNoUniqueness).toBe("SCHEDULE");
    expect(profile.pseudonymNoUniqueness).toBe("SCHEDULE");
  });
});

async function seedRepeatedExamineeNumber(pool: Pool) {
  for (const [index, schedule] of schedules.entries()) {
    await pool.execute(
      `INSERT INTO candidate_record
        (designated_sort, admission, unit_name, major, exam_date, start_time,
         period_name, building_name, room_name, examinee_no, name, birth_date,
         exam_name, label_barcode, status)
       VALUES (?, ?, 'IT 모집단위', 'IT 전공', ?, ?, ?, 'IT관', ?, ?, '유일 정책 수험생',
               '2000-01-01', ?, ?, 'ACTIVE')`,
      [
        String(index + 1),
        admissionName,
        schedule.examDate,
        schedule.examTime,
        schedule.periodName,
        schedule.roomName,
        examineeNo,
        examName,
        `BARCODE-${examineeNo}-${index + 1}`,
      ],
    );
  }
}

function profileInput(examineeNoUniqueness: "SYSTEM" | "SCHEDULE", pseudonymNoUniqueness: "ADMISSION" | "SCHEDULE") {
  return {
    schoolName: "한국대학교",
    academicYear: 2026,
    systemName: "가번호 관리 시스템",
    examineeNoUniqueness,
    pseudonymNoUniqueness,
  };
}

async function captureError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the operation to fail.");
}
