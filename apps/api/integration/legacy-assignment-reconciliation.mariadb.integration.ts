import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrationFiles } from "../src/database/migration-runner.js";
import { PseudonymsRepository } from "../src/pseudonyms/pseudonyms.repository.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationVersion = "021_reconcile_legacy_assignment_candidates.sql";
const admissionName = "IT 레거시 보정 전형";
const examName = "IT_LEGACY_RECONCILIATION";

let harness: MariaDbIntegrationHarness;
let actorUserId: number;

beforeAll(async () => {
  harness = await createMariaDbIntegrationHarness();
  const [rows] = await harness.pool.execute<Array<RowDataPacket & { id: number }>>(
    "SELECT id FROM app_user WHERE login_id = 'system' LIMIT 1",
  );
  if (!rows[0]) throw new Error("Migration fixture did not create the system account.");
  actorUserId = Number(rows[0].id);
});

afterAll(async () => {
  if (harness) await harness.cleanup();
});

describe("legacy assignment candidate reconciliation migration", () => {
  it("keeps only an exact one-candidate mapping and does not rewrite post-019 assignments", async () => {
    await harness.pool.execute("UPDATE system_profile SET pseudonym_no_uniqueness = 'SCHEDULE' WHERE id = 1");

    const zero = await seedExaminee(harness.pool, "IT-LEGACY-ZERO");
    const one = await seedExaminee(harness.pool, "IT-LEGACY-ONE");
    const two = await seedExaminee(harness.pool, "IT-LEGACY-TWO");
    const recent = await seedExaminee(harness.pool, "IT-RECENT-TWO");

    const oneCandidates = await seedCandidates(harness.pool, "IT-LEGACY-ONE", 1);
    const twoCandidates = await seedCandidates(harness.pool, "IT-LEGACY-TWO", 2);
    const recentCandidates = await seedCandidates(harness.pool, "IT-RECENT-TWO", 2);

    const zeroAssignment = await seedAssignment(harness.pool, zero, null, "8101", "BEFORE", "");
    const oneAssignment = await seedAssignment(harness.pool, one, null, "8102", "BEFORE", "");
    const twoAssignment = await seedAssignment(harness.pool, two, twoCandidates[0]!, "8103", "BEFORE", "");
    const recentScopeKey = "a".repeat(64);
    const recentAssignment = await seedAssignment(
      harness.pool,
      recent,
      recentCandidates[1]!,
      "8104",
      "AFTER",
      recentScopeKey,
    );

    const migrations = await loadMigrationFiles(resolve(apiRoot, "src/database/migrations"));
    const reconciliation = migrations.find((migration) => migration.version === migrationVersion);
    if (!reconciliation) throw new Error("Reconciliation migration file was not found.");
    await harness.pool.query(reconciliation.sql);

    const [rows] = await harness.pool.execute<
      Array<
        RowDataPacket & {
          id: number;
          candidateRecordId: number | null;
          uniquenessScopeKey: string;
        }
      >
    >(
      `SELECT id, candidate_record_id AS candidateRecordId,
              uniqueness_scope_key AS uniquenessScopeKey
       FROM pseudonym_assignment
       WHERE id IN (?, ?, ?, ?)
       ORDER BY id`,
      [zeroAssignment, oneAssignment, twoAssignment, recentAssignment],
    );
    const byId = new Map(rows.map((row) => [Number(row.id), row]));

    expect(byId.get(zeroAssignment)?.candidateRecordId).toBeNull();
    expect(Number(byId.get(oneAssignment)?.candidateRecordId)).toBe(oneCandidates[0]);
    expect(byId.get(oneAssignment)?.uniquenessScopeKey).toMatch(/^[a-f0-9]{64}$/);
    expect(byId.get(twoAssignment)?.candidateRecordId).toBeNull();
    expect(byId.get(twoAssignment)?.uniquenessScopeKey).toBe("");
    expect(Number(byId.get(recentAssignment)?.candidateRecordId)).toBe(recentCandidates[1]);
    expect(byId.get(recentAssignment)?.uniquenessScopeKey).toBe(recentScopeKey);

    const reservedForAnotherSchedule = await new PseudonymsRepository().loadReservedNumbers(
      harness.pool,
      examName,
      admissionName,
      "SCHEDULE",
      {
        date: "2038-06-02",
        time: "13:00",
        period: "IT 다른 교시",
        admission: admissionName,
      },
    );
    expect(reservedForAnotherSchedule).toEqual(new Set([8101, 8103]));
  });
});

async function seedExaminee(pool: Pool, examineeNo: string) {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO examinee
      (examinee_no, name, exam_name, exam_date, room_name, seat_no, label_barcode, status)
     VALUES (?, '통합 보정 수험생', ?, '2038-06-01', 'IT-101', '1', ?, 'ACTIVE')`,
    [examineeNo, examName, `BARCODE-${examineeNo}`],
  );
  return result.insertId;
}

async function seedCandidates(pool: Pool, examineeNo: string, count: number) {
  const ids: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const hour = String(9 + index).padStart(2, "0");
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO candidate_record
        (designated_sort, admission, unit_name, major, exam_date, start_time,
         period_name, building_name, room_name, examinee_no, name, birth_date)
       VALUES (?, ?, 'IT 모집단위', 'IT 전공', '2038-06-01', ?, ?, 'IT관', ?, ?, '통합 보정 수험생', '2000-01-01')`,
      [String(index + 1), admissionName, `${hour}:00`, `IT ${index + 1}교시`, `IT-${index + 1}`, examineeNo],
    );
    ids.push(result.insertId);
  }
  return ids;
}

async function seedAssignment(
  pool: Pool,
  examineeId: number,
  candidateRecordId: number | null,
  pseudonymNumber: string,
  relativeToMigration: "BEFORE" | "AFTER",
  uniquenessScopeKey: string,
) {
  const direction = relativeToMigration === "BEFORE" ? "DATE_SUB" : "DATE_ADD";
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO pseudonym_assignment
      (examinee_id, candidate_record_id, exam_name, admission_name, uniqueness_scope_key,
       pseudonym_no, assignment_mode, assigned_by, assigned_at)
     SELECT ?, ?, ?, ?, ?, ?, 'MANUAL', ?,
            ${direction}(applied_at, INTERVAL 1 SECOND)
     FROM schema_migration WHERE version = '019_number_uniqueness_policies.sql'`,
    [examineeId, candidateRecordId, examName, admissionName, uniquenessScopeKey, pseudonymNumber, actorUserId],
  );
  return result.insertId;
}
