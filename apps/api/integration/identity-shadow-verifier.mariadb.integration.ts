import { randomUUID } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { describe, expect, it } from "vitest";
import { IdentityBackfillService } from "../src/database/identity-backfill.js";
import { IdentityShadowVerifier } from "../src/identity-transition/identity-shadow-verifier.js";
import { createMariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

const EXAM_NAME = "2026년도 자격시험";
const SECRET = "identity-shadow-mariadb-integration-secret";

describe("isolated identity shadow verifier on MariaDB", () => {
  it("compares every source bridge, records aggregate-only observations, and can be rerun", async () => {
    const harness = await createMariaDbIntegrationHarness();
    try {
      const fixture = await insertLegacyFixture(harness.pool);
      const backfillConnection = await harness.pool.getConnection();
      try {
        const backfill = await new IdentityBackfillService().run(backfillConnection, {
          confirmIsolatedCopy: true,
          examName: EXAM_NAME,
          chunkSize: 10,
          runId: randomUUID(),
        });
        expect(backfill.status).toBe("SUCCEEDED");
      } finally {
        backfillConnection.release();
      }

      const first = await verify(harness.pool);
      expect(first.status).toBe("MATCH");
      expect(first.observations).toHaveLength(9);
      expect(first.observations.every((observation) => observation.matches)).toBe(true);
      expect(first.observations.find((item) => item.observationType.endsWith("candidate.v1"))).toMatchObject({
        oldRowCount: 1,
        newRowCount: 1,
        counts: { match: 1 },
      });
      expect(first.observations.find((item) => item.observationType.endsWith("print-snapshot.v1"))).toMatchObject({
        oldRowCount: 1,
        newRowCount: 1,
        counts: { match: 1 },
      });
      expect(first.observations.find((item) => item.observationType.endsWith("candidate-photo.v1"))).toMatchObject({
        oldRowCount: 1,
        newRowCount: 1,
        counts: { match: 1 },
      });

      const rerun = await verify(harness.pool);
      expect(rerun).toEqual(first);
      expect(await observationCount(harness.pool)).toBe(18);

      await harness.pool.execute(
        `UPDATE candidate candidate_identity
         INNER JOIN candidate_registration registration ON registration.candidate_id = candidate_identity.id
         SET candidate_identity.name = 'SYNTHETIC TARGET MISMATCH'
         WHERE registration.source_candidate_record_id = ?`,
        [fixture.candidateRecordId],
      );
      await harness.pool.execute(
        `UPDATE print_job_payload SET payload = 'SYNTHETIC PRINT MISMATCH' WHERE print_job_id = ?`,
        [fixture.printJobId],
      );
      await harness.pool.execute(
        `UPDATE candidate_identity_photo SET content_hash = REPEAT('f', 64)
         WHERE source_candidate_record_id = ?`,
        [fixture.candidateRecordId],
      );

      const mismatch = await verify(harness.pool);
      expect(mismatch.status).toBe("MISMATCH");
      expect(mismatch.observations.find((item) => item.observationType.endsWith("candidate.v1"))?.counts.mismatch).toBe(
        1,
      );
      expect(
        mismatch.observations.find((item) => item.observationType.endsWith("candidate-photo.v1"))?.counts.mismatch,
      ).toBe(1);
      expect(
        mismatch.observations.find((item) => item.observationType.endsWith("print-snapshot.v1"))?.counts.mismatch,
      ).toBe(1);

      const [observationRows] = await harness.pool.query<RowDataPacket[]>(
        `SELECT observation_type, source_high_water_mark,
                old_row_count, new_row_count, match_count, mismatch_count,
                old_only_count, new_only_count, ambiguous_count, observed_at
         FROM identity_shadow_observation ORDER BY id`,
      );
      const serialized = JSON.stringify(observationRows);
      expect(serialized).not.toContain(fixture.privateCandidateName);
      expect(serialized).not.toContain(fixture.privatePayload);
      expect(serialized).not.toContain(fixture.privatePhotoBytes);
      expect(serialized).not.toContain("SYNTHETIC TARGET MISMATCH");
      const [batchRows] = await harness.pool.query<
        Array<RowDataPacket & { batchCount: number; completedCount: number; observationCount: number }>
      >(
        `SELECT COUNT(*) AS batchCount,
                SUM(status = 'COMPLETED') AS completedCount,
                SUM(observation_count) AS observationCount
         FROM identity_shadow_verification_batch`,
      );
      expect(
        batchRows.map((row) => ({
          batchCount: Number(row.batchCount),
          completedCount: Number(row.completedCount),
          observationCount: Number(row.observationCount),
        })),
      ).toEqual([{ batchCount: 3, completedCount: 3, observationCount: 27 }]);
    } finally {
      await harness.cleanup();
    }
  }, 120_000);
});

async function verify(pool: Pool) {
  const connection = await pool.getConnection();
  try {
    return await new IdentityShadowVerifier().run(connection, {
      confirmIsolatedCopy: true,
      hmacSecret: SECRET,
    });
  } finally {
    connection.release();
  }
}

async function observationCount(pool: Pool): Promise<number> {
  const [rows] = await pool.query<Array<RowDataPacket & { count: number }>>(
    `SELECT COUNT(*) AS count FROM identity_shadow_observation`,
  );
  return Number(rows[0]?.count ?? 0);
}

async function insertLegacyFixture(pool: Pool): Promise<{
  candidateRecordId: number;
  printJobId: string;
  privateCandidateName: string;
  privatePayload: string;
  privatePhotoBytes: string;
}> {
  const [users] = await pool.query<Array<RowDataPacket & { id: number }>>(
    `SELECT id FROM app_user WHERE login_id = 'system' LIMIT 1`,
  );
  const systemUserId = Number(users[0]?.id ?? 0);
  if (!systemUserId) throw new Error("System integration user is missing.");

  const privateCandidateName = "SHADOW-PRIVATE-CANDIDATE";
  const [examineeResult] = await pool.execute<ResultSetHeader>(
    `INSERT INTO examinee
       (examinee_no, name, exam_name, exam_date, room_name, seat_no, label_barcode)
     VALUES ('20440041', ?, ?, '2044-09-01', 'Shadow Room', '41', 'SHADOW-20440041')`,
    [privateCandidateName, EXAM_NAME],
  );
  const examineeId = Number(examineeResult.insertId);

  const [candidateResult] = await pool.execute<ResultSetHeader>(
    `INSERT INTO candidate_record
       (designated_sort, track, admission, admission_code, series, series_code,
        unit_name, unit_code, major, major_code, exam_date, start_time, end_time,
        period_name, period_code, building_name, building_code, room_name, room_code,
        examinee_no, temporary_no, name, birth_date, group_name, opt1, opt2, opt3)
     VALUES
       ('1', '', 'Shadow Admission', 'SHADOW-A', '', '',
        'Shadow Unit', 'SHADOW-U', 'Shadow Major', 'SHADOW-M', '2044-09-01', '09:00', '10:00',
        'Shadow Period', 'SHADOW-P', 'Shadow Building', 'SHADOW-B', 'Shadow Room', 'SHADOW-R',
        '20440041', '1001', ?, '2000-01-01', 'Shadow Group', 'A', 'B', 'C')`,
    [privateCandidateName],
  );
  const candidateRecordId = Number(candidateResult.insertId);
  const privatePhotoBytes = "SHADOW-PRIVATE-PHOTO-BINARY";
  await pool.execute(
    `INSERT INTO candidate_photo
       (candidate_record_id, file_name, mime_type, content, content_hash)
     VALUES (?, 'private-candidate.jpg', 'image/jpeg', ?, REPEAT('a', 64))`,
    [candidateRecordId, Buffer.from(privatePhotoBytes, "utf8")],
  );

  const [settings] = await pool.query<Array<RowDataPacket & { id: number }>>(
    `SELECT id FROM pseudonym_setting WHERE exam_name = ? AND admission_name = '' LIMIT 1`,
    [EXAM_NAME],
  );
  const settingId = Number(settings[0]?.id ?? 0);
  if (!settingId) throw new Error("Seeded pseudonym setting is missing.");
  await pool.execute(
    `INSERT INTO pseudonym_time_range
       (setting_id, exam_date, exam_time, period_name, admission, unit_name, major,
        building_name, room_name, schedule_key, range_start, range_end, next_sequence, updated_by)
     VALUES (?, '2044-09-01', '09:00', 'Shadow Period', 'Shadow Admission', 'Shadow Unit',
             'Shadow Major', 'Shadow Building', 'Shadow Room', SHA2('shadow-range-v1', 256),
             1001, 1100, 1002, ?)`,
    [settingId, systemUserId],
  );

  await pool.execute(
    `INSERT INTO pseudonym_operation
       (exam_name, exam_date, exam_time, period_name, admission_name,
        closed, closed_by, closed_at)
     VALUES (?, '2044-09-01', '09:00', 'Shadow Period', 'Shadow Admission',
             TRUE, ?, '2044-09-01 11:00:00.000')`,
    [EXAM_NAME, systemUserId],
  );
  await pool.execute(
    `INSERT INTO pseudonym_assignment
       (examinee_id, candidate_record_id, exam_name, admission_name,
        uniqueness_scope_key, pseudonym_no, assignment_mode, is_absentee,
        auto_assigned_on_close, assigned_by, assigned_at)
     VALUES (?, ?, ?, 'Shadow Admission', SHA2('shadow-assignment-scope-v1', 256),
             '1001', 'MANUAL', FALSE, FALSE, ?, '2044-09-01 10:30:00.000')`,
    [examineeId, candidateRecordId, EXAM_NAME, systemUserId],
  );

  const [templates] = await pool.query<Array<RowDataPacket & { id: number; version: number }>>(
    `SELECT id, version FROM label_template ORDER BY id LIMIT 1`,
  );
  const template = templates[0];
  if (!template) throw new Error("Seeded label template is missing.");
  const printJobId = randomUUID();
  const privatePayload = "^XA^FDSHADOW-PRIVATE-PRINT-PAYLOAD^FS^XZ";
  await pool.execute(
    `INSERT INTO print_job
       (id, job_no, label_type, business_ref, template_id, template_version,
        requested_by, copies, status, expires_at)
     VALUES (?, 'SHADOW-JOB-1', 'PSEUDONYM', 'shadow-ref', ?, ?, ?, 1, 'CREATED', '2045-01-01')`,
    [printJobId, template.id, template.version, systemUserId],
  );
  await pool.execute(`INSERT INTO print_job_payload (print_job_id, format, payload) VALUES (?, 'ZPL', ?)`, [
    printJobId,
    privatePayload,
  ]);

  return { candidateRecordId, printJobId, privateCandidateName, privatePayload, privatePhotoBytes };
}
