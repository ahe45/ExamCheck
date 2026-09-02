import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { describe, expect, it } from "vitest";
import {
  CandidateIdentityRepository,
  IdentityProjectionConflictError,
  type CandidateIdentityProjection,
} from "../src/candidates/candidate-identity.repository.js";
import { createMariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

const examName = "Identity Resolution Isolated IT";

interface CandidateSourceInput {
  admission: string;
  admissionCode: string;
  unitName: string;
  unitCode: string;
  major: string;
  majorCode: string;
  examDate: string;
  startTime: string;
  endTime: string;
  periodName: string;
  periodCode: string;
  buildingName: string;
  buildingCode: string;
  roomName: string;
  roomCode: string;
  examineeNo: string;
  name: string;
  birthDate: string;
}

describe("candidate identity resolution on isolated MariaDB", () => {
  it("keeps admission, slot, and segment IDs while enriching later source codes", async () => {
    await withHarness(async (pool) => {
      const sourceId = await insertCandidateRecord(pool, {
        ...baseSource("RESOLUTION-001"),
        admission: " Ａ 전형 ",
        admissionCode: "",
        unitName: " Ｕ 학부 ",
        unitCode: "",
        periodName: " １교시 ",
        periodCode: "",
        buildingName: " Ｂ 본관 ",
        buildingCode: "",
        roomName: " １０１호 ",
        roomCode: "",
      });
      const first = await syncCandidate(pool, sourceId);

      await pool.execute(
        `UPDATE candidate_record
         SET admission = 'A 전형', admission_code = 'adm-a',
             unit_name = 'U 학부', unit_code = 'unit-u',
             period_name = '1교시', period_code = 'period-1',
             building_name = 'B 본관', building_code = 'building-b',
             room_name = '101호', room_code = 'room-101'
         WHERE id = ?`,
        [sourceId],
      );
      const enriched = await syncCandidate(pool, sourceId);

      expect(enriched).toEqual(first);
      const [admissions] = await pool.execute<
        Array<RowDataPacket & { id: number; sourceCode: string; displayName: string; canonicalName: string }>
      >(
        `SELECT id, source_code AS sourceCode, display_name AS displayName,
                canonical_name AS canonicalName
         FROM admission WHERE id = ?`,
        [first.admissionId],
      );
      expect(admissions).toEqual([
        {
          id: first.admissionId,
          sourceCode: "ADM-A",
          displayName: "A 전형",
          canonicalName: "A 전형",
        },
      ]);
      const [aliases] = await pool.execute<
        Array<RowDataPacket & { admissionId: number; aliasType: string; aliasValue: string }>
      >(
        `SELECT admission_id AS admissionId, alias_type AS aliasType, alias_value AS aliasValue
         FROM admission_identity_alias WHERE admission_id = ? ORDER BY alias_type`,
        [first.admissionId],
      );
      expect(aliases).toEqual([
        { admissionId: first.admissionId, aliasType: "CODE", aliasValue: "ADM-A" },
        { admissionId: first.admissionId, aliasType: "NAME", aliasValue: "A 전형" },
      ]);
      const [slots] = await pool.execute<Array<RowDataPacket & { id: number; periodCode: string }>>(
        "SELECT id, period_code AS periodCode FROM operation_slot WHERE id = ?",
        [first.operationSlotId],
      );
      expect(slots).toEqual([{ id: first.operationSlotId, periodCode: "PERIOD-1" }]);
      const [segments] = await pool.execute<
        Array<
          RowDataPacket & {
            id: number;
            unitCode: string;
            buildingCode: string;
            roomCode: string;
          }
        >
      >(
        `SELECT id, unit_code AS unitCode, building_code AS buildingCode, room_code AS roomCode
         FROM schedule_segment WHERE id = ?`,
        [first.scheduleSegmentId],
      );
      expect(segments).toEqual([
        {
          id: first.scheduleSegmentId,
          unitCode: "UNIT-U",
          buildingCode: "BUILDING-B",
          roomCode: "ROOM-101",
        },
      ]);
    });
  });

  it("fails closed when code and name aliases point to different admissions", async () => {
    await withHarness(async (pool) => {
      const alphaId = await insertCandidateRecord(pool, {
        ...baseSource("RESOLUTION-ALPHA"),
        admission: "Alpha Admission",
        admissionCode: "ADM-ALPHA",
      });
      const betaId = await insertCandidateRecord(pool, {
        ...baseSource("RESOLUTION-BETA"),
        admission: "Beta Admission",
        admissionCode: "ADM-BETA",
        startTime: "10:30",
        endTime: "11:30",
        periodName: "Beta Period",
        periodCode: "PERIOD-BETA",
      });
      await syncCandidate(pool, alphaId);
      await syncCandidate(pool, betaId);
      await pool.execute("UPDATE candidate_record SET admission = 'Alpha Admission' WHERE id = ?", [betaId]);

      const error = await syncCandidate(pool, betaId).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(IdentityProjectionConflictError);
      expect(error).toMatchObject({
        code: "ADMISSION_ALIAS_CONFLICT",
        entityType: "candidate_record",
        sourceId: betaId,
      });
      expect(String(error)).not.toContain("Alpha Admission");
      expect(String(error)).not.toContain("ADM-BETA");
      const [counts] = await pool.query<Array<RowDataPacket & { count: number }>>(
        "SELECT COUNT(*) AS count FROM admission",
      );
      expect(Number(counts[0]?.count)).toBe(2);
    });
  });

  it("fails closed when a stable slot or segment code conflicts with a name-based match", async () => {
    await withHarness(async (pool) => {
      const firstId = await insertCandidateRecord(pool, {
        ...baseSource("RESOLUTION-CODE-A"),
        periodName: "Period Alpha",
        periodCode: "PERIOD-A",
        unitName: "Unit Alpha",
        unitCode: "UNIT-A",
      });
      const secondId = await insertCandidateRecord(pool, {
        ...baseSource("RESOLUTION-CODE-B"),
        periodName: "Period Beta",
        periodCode: "PERIOD-B",
        unitName: "Unit Beta",
        unitCode: "UNIT-B",
      });
      await syncCandidate(pool, firstId);
      await syncCandidate(pool, secondId);

      await pool.execute("UPDATE candidate_record SET period_name = 'Period Alpha' WHERE id = ?", [secondId]);
      const slotError = await syncCandidate(pool, secondId).catch((caught: unknown) => caught);
      expect(slotError).toMatchObject({
        code: "REGISTRATION_SOURCE_CONFLICT",
        entityType: "operation_slot",
        sourceId: secondId,
      });

      await pool.execute(
        `UPDATE candidate_record
         SET period_name = 'Period Alpha', period_code = 'PERIOD-A', unit_name = 'Unit Alpha'
         WHERE id = ?`,
        [secondId],
      );
      const segmentError = await syncCandidate(pool, secondId).catch((caught: unknown) => caught);
      expect(segmentError).toMatchObject({
        code: "REGISTRATION_SOURCE_CONFLICT",
        entityType: "schedule_segment",
        sourceId: secondId,
      });
      expect(String(segmentError)).not.toContain("Unit Alpha");
      expect(String(segmentError)).not.toContain("UNIT-B");
    });
  });
});

async function withHarness(task: (pool: Pool) => Promise<void>): Promise<void> {
  const harness = await createMariaDbIntegrationHarness();
  try {
    await task(harness.pool);
  } finally {
    await harness.cleanup();
  }
}

async function syncCandidate(pool: Pool, sourceId: number): Promise<CandidateIdentityProjection> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const projection = await new CandidateIdentityRepository().syncCandidateRecord(connection, sourceId, examName);
    await connection.commit();
    return projection;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function insertCandidateRecord(pool: Pool, input: CandidateSourceInput): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO candidate_record
      (admission, admission_code, unit_name, unit_code, major, major_code,
       exam_date, start_time, end_time, period_name, period_code,
       building_name, building_code, room_name, room_code,
       examinee_no, name, birth_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.admission,
      input.admissionCode,
      input.unitName,
      input.unitCode,
      input.major,
      input.majorCode,
      input.examDate,
      input.startTime,
      input.endTime,
      input.periodName,
      input.periodCode,
      input.buildingName,
      input.buildingCode,
      input.roomName,
      input.roomCode,
      input.examineeNo,
      input.name,
      input.birthDate,
    ],
  );
  return Number(result.insertId);
}

function baseSource(examineeNo: string): CandidateSourceInput {
  return {
    admission: "Resolution Admission",
    admissionCode: "RESOLUTION-ADMISSION",
    unitName: "Resolution Unit",
    unitCode: "RESOLUTION-UNIT",
    major: "",
    majorCode: "",
    examDate: "2046-09-01",
    startTime: "09:00",
    endTime: "10:00",
    periodName: "Resolution Period",
    periodCode: "RESOLUTION-PERIOD",
    buildingName: "Resolution Building",
    buildingCode: "RESOLUTION-BUILDING",
    roomName: "Resolution Room",
    roomCode: "RESOLUTION-ROOM",
    examineeNo,
    name: `Candidate ${examineeNo}`,
    birthDate: "2000-01-01",
  };
}
