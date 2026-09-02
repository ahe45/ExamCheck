import { createHash, randomUUID } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { describe, expect, it } from "vitest";
import { CandidateIdentityRepository } from "../src/candidates/candidate-identity.repository.js";
import type { SqlExecutor } from "../src/common/database/sql-executor.js";
import {
  IdentityBackfillProjectionError,
  IdentityBackfillProjectionRepository,
} from "../src/database/identity-backfill-projection.repository.js";
import { IdentityBackfillService } from "../src/database/identity-backfill.js";
import type { IdentityBackfillOptions, IdentityBackfillReport } from "../src/database/identity-backfill.types.js";
import { defaultPolicyScopeKey } from "../src/identity-transition/identity-keys.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

const examName = "2044 Identity Backfill Integration";

interface LegacySchedule {
  admission: string;
  examDate: string;
  startTime: string;
  endTime: string;
  periodName: string;
  periodCode: string;
  unitName: string;
  buildingName: string;
  roomName: string;
}

interface SourceCandidateInput {
  examineeNo: string;
  name: string;
  birthDate: string;
  schedule: LegacySchedule;
}

interface SourceCandidateFixture {
  examineeId: number;
  sourceCandidateRecordId: number;
}

interface TargetCounts {
  candidates: number;
  registrations: number;
  candidatePhotos: number;
  assignments: number;
  operationEvents: number;
  assignmentEvents: number;
  printSnapshots: number;
  accountScopes: number;
}

describe("identity backfill on isolated MariaDB", () => {
  it("backfills a conflict-free source, preserves audit projections, and is idempotent under a new run", async () => {
    await withCleanHarness(async (harness, systemUserId) => {
      const schedule = createSchedule({
        admission: "Synthetic Admission Success",
        startTime: "09:00",
        endTime: "10:00",
        periodName: "Success Period",
        periodCode: "SUCCESS-1",
        roomName: "Success Room",
      });
      const first = await insertSourceCandidate(harness.pool, {
        examineeNo: "20441001",
        name: "Synthetic Success One",
        birthDate: "2000-01-01",
        schedule,
      });
      await insertSourceCandidate(harness.pool, {
        examineeNo: "20441002",
        name: "Synthetic Success Two",
        birthDate: "2000-02-02",
        schedule,
      });
      await insertCandidatePhoto(harness.pool, first.sourceCandidateRecordId);

      const defaultSettingId = await insertSetting(harness.pool, systemUserId, "", 9001, 9001);
      await insertTimeRange(harness.pool, systemUserId, defaultSettingId, schedule, 9001, 9001);
      const settingId = await insertSetting(harness.pool, systemUserId, schedule.admission, 5101, 5102);
      await insertTimeRange(harness.pool, systemUserId, settingId, schedule, 5101, 5102);
      await insertClosedOperation(harness.pool, systemUserId, schedule);
      await insertAssignment(harness.pool, {
        systemUserId,
        examineeId: first.examineeId,
        sourceCandidateRecordId: first.sourceCandidateRecordId,
        admission: schedule.admission,
        pseudonymNo: "5101",
      });
      const operatorUserId = await insertScopedOperator(harness.pool, schedule.admission);
      const printJobId = await insertPrintJob(harness.pool, systemUserId);

      const firstRunId = randomUUID();
      const firstReport = await runBackfill(harness, new IdentityBackfillService(), {
        examName,
        chunkSize: 1,
        runId: firstRunId,
      });

      expect(firstReport).toMatchObject({
        runId: firstRunId,
        status: "SUCCEEDED",
        sourceCandidateCount: 2,
        targetRegistrationCount: 2,
        targetCandidateCount: 2,
        exactAssignmentCount: 1,
        legacyReservationCount: 0,
        acceptedIssueCount: 0,
        blockingIssueCount: 0,
        issueSummary: [],
      });
      await expectBackfilledLegacyModes(harness.pool, firstRunId);

      const firstCounts = await loadTargetCounts(harness.pool);
      expect(firstCounts).toEqual({
        candidates: 2,
        registrations: 2,
        candidatePhotos: 1,
        assignments: 1,
        operationEvents: 1,
        assignmentEvents: 1,
        printSnapshots: 1,
        accountScopes: 1,
      });

      const [operatorRows] = await harness.pool.execute<
        Array<RowDataPacket & { admissionScopeMode: string; admissionId: number }>
      >(
        `SELECT user.admission_scope_mode AS admissionScopeMode,
                  scope.admission_id AS admissionId
           FROM app_user user
           INNER JOIN user_admission_scope_assignment scope ON scope.user_id = user.id
           WHERE user.id = ?`,
        [operatorUserId],
      );
      expect(operatorRows).toHaveLength(1);
      expect(operatorRows[0]?.admissionScopeMode).toBe("ASSIGNED");
      expect(Number(operatorRows[0]?.admissionId)).toBeGreaterThan(0);

      const [snapshotRows] = await harness.pool.execute<Array<RowDataPacket & { projectionDigest: string }>>(
        `SELECT projection_digest AS projectionDigest
           FROM print_projection_snapshot WHERE print_job_id = ?`,
        [printJobId],
      );
      expect(snapshotRows).toHaveLength(1);
      expect(snapshotRows[0]?.projectionDigest).toMatch(/^[a-f0-9]{64}$/i);

      const secondRunId = randomUUID();
      const secondReport = await runBackfill(harness, new IdentityBackfillService(), {
        examName,
        chunkSize: 2,
        runId: secondRunId,
      });
      expect(secondReport).toMatchObject({
        runId: secondRunId,
        status: "SUCCEEDED",
        sourceCandidateCount: 2,
        targetRegistrationCount: 2,
        targetCandidateCount: 2,
        exactAssignmentCount: 1,
        acceptedIssueCount: 0,
        blockingIssueCount: 0,
      });
      expect(await loadTargetCounts(harness.pool)).toEqual(firstCounts);
      await expectBackfilledLegacyModes(harness.pool, secondRunId);

      const [runRows] = await harness.pool.execute<Array<RowDataPacket & { status: string }>>(
        `SELECT status FROM identity_backfill_run WHERE id IN (?, ?) ORDER BY id`,
        [firstRunId, secondRunId],
      );
      expect(runRows.map((row) => row.status)).toEqual(["SUCCEEDED", "SUCCEEDED"]);
    });
  }, 120_000);

  it("keeps unrestricted accounts at ALL scope despite stale legacy admission assignments", async () => {
    await withCleanHarness(async (harness) => {
      const adminUserId = await insertUnrestrictedUserWithLegacyScope(
        harness.pool,
        "ADMIN",
        "Unmapped Legacy Admin Admission",
      );
      const developerUserId = await insertUnrestrictedUserWithLegacyScope(
        harness.pool,
        "DEVELOPER",
        "Unmapped Legacy Developer Admission",
      );

      const runId = randomUUID();
      const report = await runBackfill(harness, new IdentityBackfillService(), { examName, runId });

      expect(report).toMatchObject({
        runId,
        status: "SUCCEEDED",
        sourceCandidateCount: 0,
        targetRegistrationCount: 0,
        targetCandidateCount: 0,
        acceptedIssueCount: 0,
        blockingIssueCount: 0,
        issueSummary: [],
      });
      const [scopeRows] = await harness.pool.execute<
        Array<
          RowDataPacket & {
            role: "ADMIN" | "DEVELOPER";
            admissionScopeMode: string;
            legacyAssignmentCount: number;
            targetAssignmentCount: number;
          }
        >
      >(
        `SELECT user.role,
                user.admission_scope_mode AS admissionScopeMode,
                (SELECT COUNT(*) FROM user_admission_assignment legacy
                  WHERE legacy.user_id = user.id) AS legacyAssignmentCount,
                (SELECT COUNT(*) FROM user_admission_scope_assignment target
                  WHERE target.user_id = user.id) AS targetAssignmentCount
         FROM app_user user
         WHERE user.id IN (?, ?)
         ORDER BY FIELD(user.role, 'ADMIN', 'DEVELOPER')`,
        [adminUserId, developerUserId],
      );
      expect(
        scopeRows.map((row) => ({
          role: row.role,
          admissionScopeMode: row.admissionScopeMode,
          legacyAssignmentCount: Number(row.legacyAssignmentCount),
          targetAssignmentCount: Number(row.targetAssignmentCount),
        })),
      ).toEqual([
        {
          role: "ADMIN",
          admissionScopeMode: "ALL",
          legacyAssignmentCount: 1,
          targetAssignmentCount: 0,
        },
        {
          role: "DEVELOPER",
          admissionScopeMode: "ALL",
          legacyAssignmentCount: 1,
          targetAssignmentCount: 0,
        },
      ]);
      await expectBackfilledLegacyModes(harness.pool, runId);
    });
  }, 120_000);

  it.each(["MATCHING", "PREASSIGNED"] as const)(
    "does not require pseudonym ranges for the %s assignment method",
    async (assignmentMethod) => {
      await withCleanHarness(async (harness, systemUserId) => {
        const schedule = createSchedule({
          admission: `Synthetic ${assignmentMethod} Admission`,
          periodName: `${assignmentMethod} Period`,
          periodCode: `${assignmentMethod}-1`,
          roomName: `${assignmentMethod} Room`,
        });
        await insertSourceCandidate(harness.pool, {
          examineeNo: assignmentMethod === "MATCHING" ? "20441501" : "20441502",
          name: `Synthetic ${assignmentMethod} Candidate`,
          birthDate: "2000-05-01",
          schedule,
        });
        await insertSetting(harness.pool, systemUserId, schedule.admission, 1, 1, assignmentMethod);

        const runId = randomUUID();
        const report = await runBackfill(harness, new IdentityBackfillService(), { examName, runId });

        expect(report).toMatchObject({
          status: "SUCCEEDED",
          sourceCandidateCount: 1,
          targetRegistrationCount: 1,
          blockingIssueCount: 0,
          issueSummary: [],
        });
        await expectBackfilledLegacyModes(harness.pool, runId);
      });
    },
    120_000,
  );

  it("blocks overlapping, insufficient admission ranges without changing legacy read or write modes", async () => {
    await withCleanHarness(async (harness, systemUserId) => {
      const admission = "Synthetic Admission Blocked";
      const firstSchedule = createSchedule({
        admission,
        startTime: "09:00",
        endTime: "10:00",
        periodName: "Blocked Period One",
        periodCode: "BLOCKED-1",
        roomName: "Blocked Room One",
      });
      const secondSchedule = createSchedule({
        admission,
        startTime: "10:30",
        endTime: "11:30",
        periodName: "Blocked Period Two",
        periodCode: "BLOCKED-2",
        roomName: "Blocked Room Two",
      });
      await insertSourceCandidate(harness.pool, {
        examineeNo: "20442001",
        name: "Synthetic Blocked One",
        birthDate: "2001-01-01",
        schedule: firstSchedule,
      });
      await insertSourceCandidate(harness.pool, {
        examineeNo: "20442002",
        name: "Synthetic Blocked Two",
        birthDate: "2001-02-02",
        schedule: secondSchedule,
      });
      const settingId = await insertSetting(harness.pool, systemUserId, admission, 6101, 6101);
      await insertTimeRange(harness.pool, systemUserId, settingId, firstSchedule, 6101, 6101);
      await insertTimeRange(harness.pool, systemUserId, settingId, secondSchedule, 6101, 6101);

      const runId = randomUUID();
      const report = await runBackfill(harness, new IdentityBackfillService(), {
        examName,
        runId,
      });

      expect(report).toMatchObject({
        runId,
        status: "BLOCKED",
        sourceCandidateCount: 2,
        targetRegistrationCount: 2,
        targetCandidateCount: 2,
        blockingIssueCount: 2,
      });
      expect(report.issueSummary).toEqual([
        { code: "ADMISSION_RANGE_CAPACITY_DEFICIT", status: "OPEN", count: 1 },
        { code: "ADMISSION_RANGE_OVERLAP", status: "OPEN", count: 1 },
      ]);
      await expectBlockedLegacyModes(harness.pool, runId);
    });
  }, 120_000);

  it("blocks canonical reuse of a number preserved by an unmapped legacy assignment", async () => {
    await withCleanHarness(async (harness, systemUserId) => {
      const schedule = createSchedule({
        admission: "Synthetic Reserved Number Admission",
        periodName: "Reserved Number Period",
        periodCode: "RESERVED-1",
        roomName: "Reserved Number Room",
      });
      const candidate = await insertSourceCandidate(harness.pool, {
        examineeNo: "20442501",
        name: "Synthetic Reserved Number Candidate",
        birthDate: "2001-05-01",
        schedule,
      });
      const settingId = await insertSetting(harness.pool, systemUserId, schedule.admission, 6151, 6151);
      await insertTimeRange(harness.pool, systemUserId, settingId, schedule, 6151, 6151);
      await insertAssignment(harness.pool, {
        systemUserId,
        examineeId: candidate.examineeId,
        sourceCandidateRecordId: candidate.sourceCandidateRecordId,
        admission: schedule.admission,
        pseudonymNo: "6151",
      });
      await insertOrphanAssignment(harness.pool, systemUserId, schedule.admission, "6151");

      const runId = randomUUID();
      const report = await runBackfill(harness, new IdentityBackfillService(), { examName, runId });

      expect(report).toMatchObject({
        status: "BLOCKED",
        exactAssignmentCount: 1,
        legacyReservationCount: 0,
        acceptedIssueCount: 1,
        blockingIssueCount: 1,
      });
      expect(report.issueSummary).toEqual([
        { code: "PSEUDONYM_NUMBER_RESERVED", status: "OPEN", count: 1 },
        { code: "ORPHAN_EXAMINEE_PRESERVED", status: "ACCEPTED", count: 1 },
      ]);
      await expectBlockedLegacyModes(harness.pool, runId);
    });
  }, 120_000);

  it("does not overwrite an immutable legacy reservation when a stale race reaches duplicate insert", async () => {
    await withCleanHarness(async (harness, systemUserId) => {
      const [cycle] = await harness.pool.execute<ResultSetHeader>(
        `INSERT INTO exam_cycle
          (system_profile_id, cycle_code, display_name, academic_year, status, created_by, updated_by)
         VALUES (1, 'YEAR:2044', ?, 2044, 'ACTIVE', ?, ?)`,
        [examName, systemUserId, systemUserId],
      );
      const examCycleId = Number(cycle.insertId);
      const firstSourceId = await insertOrphanAssignment(
        harness.pool,
        systemUserId,
        "",
        "6201",
        `${examName} Legacy Owner`,
      );
      const competingSourceId = await insertOrphanAssignment(
        harness.pool,
        systemUserId,
        "",
        "6201",
        `${examName} Legacy Competitor`,
      );
      const scopeKey = defaultPolicyScopeKey(examCycleId);
      await harness.pool.execute(
        `INSERT INTO legacy_pseudonym_reservation
          (exam_cycle_id, admission_id, source_assignment_id, scope_key, pseudonym_value, reason_code)
         VALUES (?, NULL, ?, ?, 6201, 'UNMAPPED_SOURCE_ASSIGNMENT')`,
        [examCycleId, firstSourceId, scopeKey],
      );

      const connection = await harness.pool.getConnection();
      try {
        await connection.beginTransaction();
        const staleExecutor = {
          execute: async (sql: string, values: readonly unknown[] = []) => {
            const hidesCompetingReservation =
              sql.includes("FROM legacy_pseudonym_reservation") &&
              (sql.includes("WHERE exam_cycle_id = ? AND pseudonym_value = ?") ||
                sql.includes("WHERE scope_key = ? AND pseudonym_value = ?"));
            if (hidesCompetingReservation) return [[], []] as never;
            return connection.execute(sql, values as never);
          },
          query: connection.query.bind(connection),
        } as unknown as SqlExecutor;

        const error = await new IdentityBackfillProjectionRepository()
          .syncAssignment(staleExecutor, competingSourceId, examCycleId)
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(IdentityBackfillProjectionError);
        expect(error).toMatchObject({
          code: "LEGACY_RESERVATION_CONFLICT",
          entityType: "pseudonym_assignment",
          sourceId: competingSourceId,
          details: {},
        });
        expect(String(error)).not.toContain("6201");
        await connection.rollback();
      } finally {
        connection.release();
      }

      const [reservations] = await harness.pool.execute<
        Array<RowDataPacket & { sourceAssignmentId: number; pseudonymValue: number }>
      >(
        `SELECT source_assignment_id AS sourceAssignmentId, pseudonym_value AS pseudonymValue
         FROM legacy_pseudonym_reservation WHERE scope_key = ?`,
        [scopeKey],
      );
      expect(reservations).toEqual([{ sourceAssignmentId: firstSourceId, pseudonymValue: 6201 }]);
    });
  }, 120_000);

  it("quarantines a candidate identity conflict without PII and continues later source rows", async () => {
    await withCleanHarness(async (harness) => {
      const firstSchedule = createSchedule({
        admission: "Synthetic Admission Conflict",
        startTime: "09:00",
        endTime: "10:00",
        periodName: "Conflict Period One",
        periodCode: "CONFLICT-1",
        roomName: "Conflict Room One",
      });
      const laterSchedule = createSchedule({
        admission: firstSchedule.admission,
        startTime: "10:30",
        endTime: "11:30",
        periodName: "Conflict Period Two",
        periodCode: "CONFLICT-2",
        roomName: "Conflict Room Two",
      });
      const sharedNumber = "20443001";
      const piiConflictName = "Synthetic Quarantined Identity";
      const first = await insertSourceCandidate(harness.pool, {
        examineeNo: sharedNumber,
        name: "Synthetic Canonical Identity",
        birthDate: "2002-01-01",
        schedule: firstSchedule,
      });
      const conflictingSourceId = await insertCandidateRecord(harness.pool, {
        examineeNo: sharedNumber,
        name: piiConflictName,
        birthDate: "2003-03-03",
        schedule: laterSchedule,
      });
      const continued = await insertSourceCandidate(harness.pool, {
        examineeNo: "20443002",
        name: "Synthetic Continued Identity",
        birthDate: "2002-02-02",
        schedule: laterSchedule,
      });

      const runId = randomUUID();
      const report = await runBackfill(harness, new IdentityBackfillService(), {
        examName,
        chunkSize: 1,
        runId,
      });

      expect(report).toMatchObject({
        status: "BLOCKED",
        sourceCandidateCount: 3,
        targetRegistrationCount: 2,
        targetCandidateCount: 2,
        blockingIssueCount: 2,
      });
      const [registrationRows] = await harness.pool.query<Array<RowDataPacket & { sourceCandidateRecordId: number }>>(
        `SELECT source_candidate_record_id AS sourceCandidateRecordId
           FROM candidate_registration ORDER BY source_candidate_record_id`,
      );
      expect(registrationRows.map((row) => Number(row.sourceCandidateRecordId))).toEqual([
        first.sourceCandidateRecordId,
        continued.sourceCandidateRecordId,
      ]);

      const [issueRows] = await harness.pool.execute<
        Array<
          RowDataPacket & {
            entityType: string;
            sourceId: number;
            issueCode: string;
            detailsJson: unknown;
            status: string;
          }
        >
      >(
        `SELECT entity_type AS entityType, source_id AS sourceId, issue_code AS issueCode,
                  details_json AS detailsJson, status
           FROM identity_migration_issue
           WHERE run_id = ? AND issue_code = 'CANDIDATE_PERSONAL_IDENTITY_CONFLICT'`,
        [runId],
      );
      expect(issueRows).toEqual([
        {
          entityType: "candidate_record",
          sourceId: conflictingSourceId,
          issueCode: "CANDIDATE_PERSONAL_IDENTITY_CONFLICT",
          detailsJson: null,
          status: "OPEN",
        },
      ]);
      const serializedIssue = JSON.stringify({ report, issues: issueRows });
      expect(serializedIssue).not.toContain(sharedNumber);
      expect(serializedIssue).not.toContain(piiConflictName);

      const [checkpointRows] = await harness.pool.execute<
        Array<RowDataPacket & { lastSourceId: number; processedCount: number }>
      >(
        `SELECT last_source_id AS lastSourceId, processed_count AS processedCount
           FROM identity_backfill_checkpoint
           WHERE run_id = ? AND entity_type = 'candidate_record'`,
        [runId],
      );
      expect(checkpointRows.map(normalizeCheckpoint)).toEqual([
        { lastSourceId: continued.sourceCandidateRecordId, processedCount: 3 },
      ]);
      await expectBlockedLegacyModes(harness.pool, runId);
    });
  }, 120_000);

  it("keeps registrations while quarantining conflicting photos for the same candidate identity", async () => {
    await withCleanHarness(async (harness) => {
      const firstSchedule = createSchedule({
        admission: "Synthetic Admission Photo Conflict",
        startTime: "09:00",
        endTime: "10:00",
        periodName: "Photo Period One",
        periodCode: "PHOTO-1",
        roomName: "Photo Room One",
      });
      const secondSchedule = createSchedule({
        admission: firstSchedule.admission,
        startTime: "10:30",
        endTime: "11:30",
        periodName: "Photo Period Two",
        periodCode: "PHOTO-2",
        roomName: "Photo Room Two",
      });
      const identity = {
        examineeNo: "20443501",
        name: "Synthetic Photo Identity",
        birthDate: "2003-05-05",
      };
      const first = await insertSourceCandidate(harness.pool, { ...identity, schedule: firstSchedule });
      const secondSourceId = await insertCandidateRecord(harness.pool, { ...identity, schedule: secondSchedule });
      await insertCandidatePhoto(harness.pool, first.sourceCandidateRecordId, "synthetic-photo-first");
      await insertCandidatePhoto(harness.pool, secondSourceId, "synthetic-photo-conflict");

      const runId = randomUUID();
      const report = await runBackfill(harness, new IdentityBackfillService(), { examName, chunkSize: 1, runId });

      expect(report).toMatchObject({
        status: "BLOCKED",
        sourceCandidateCount: 2,
        targetRegistrationCount: 2,
        targetCandidateCount: 1,
        blockingIssueCount: 1,
      });
      expect(report.issueSummary).toEqual([{ code: "CANDIDATE_PHOTO_CONFLICT", status: "OPEN", count: 1 }]);
      expect(await targetRegistrationSourceIds(harness.pool)).toEqual([first.sourceCandidateRecordId, secondSourceId]);
      const [photoRows] = await harness.pool.query<Array<RowDataPacket & { count: number; contentHash: string }>>(
        "SELECT COUNT(*) AS count, MAX(content_hash) AS contentHash FROM candidate_identity_photo",
      );
      expect(Number(photoRows[0]?.count)).toBe(1);
      expect(photoRows[0]?.contentHash).toBe(digestHex("synthetic-photo-first"));
      await expectBlockedLegacyModes(harness.pool, runId);
    });
  }, 120_000);

  it("resumes the same failed run from its committed candidate checkpoint", async () => {
    await withCleanHarness(async (harness) => {
      const schedule = createSchedule({
        admission: "Synthetic Admission Resume",
        startTime: "13:00",
        endTime: "14:00",
        periodName: "Resume Period",
        periodCode: "RESUME-1",
        roomName: "Resume Room",
      });
      const first = await insertSourceCandidate(harness.pool, {
        examineeNo: "20444001",
        name: "Synthetic Resume One",
        birthDate: "2004-01-01",
        schedule,
      });
      const second = await insertSourceCandidate(harness.pool, {
        examineeNo: "20444002",
        name: "Synthetic Resume Two",
        birthDate: "2004-02-02",
        schedule,
      });
      const third = await insertSourceCandidate(harness.pool, {
        examineeNo: "20444003",
        name: "Synthetic Resume Three",
        birthDate: "2004-03-03",
        schedule,
      });
      const runId = randomUUID();
      const service = new IdentityBackfillService(new FailOnceCandidateRepository(second.sourceCandidateRecordId));

      await expect(runBackfill(harness, service, { examName, chunkSize: 1, runId })).rejects.toThrow(
        "synthetic checkpoint interruption",
      );

      const [failedRunRows] = await harness.pool.execute<Array<RowDataPacket & { status: string }>>(
        "SELECT status FROM identity_backfill_run WHERE id = ?",
        [runId],
      );
      expect(failedRunRows).toEqual([{ status: "FAILED" }]);
      const [failedCheckpointRows] = await harness.pool.execute<
        Array<RowDataPacket & { lastSourceId: number; processedCount: number }>
      >(
        `SELECT last_source_id AS lastSourceId, processed_count AS processedCount
           FROM identity_backfill_checkpoint
           WHERE run_id = ? AND entity_type = 'candidate_record'`,
        [runId],
      );
      expect(failedCheckpointRows.map(normalizeCheckpoint)).toEqual([
        { lastSourceId: first.sourceCandidateRecordId, processedCount: 1 },
      ]);
      expect(await targetRegistrationSourceIds(harness.pool)).toEqual([first.sourceCandidateRecordId]);
      await expectBlockedLegacyModes(harness.pool, runId);

      const resumed = await runBackfill(harness, service, { examName, chunkSize: 1, runId });
      expect(resumed).toMatchObject({
        runId,
        status: "SUCCEEDED",
        sourceHighWaterMark: third.sourceCandidateRecordId,
        sourceCandidateCount: 3,
        targetRegistrationCount: 3,
        targetCandidateCount: 3,
        blockingIssueCount: 0,
      });
      expect(await targetRegistrationSourceIds(harness.pool)).toEqual([
        first.sourceCandidateRecordId,
        second.sourceCandidateRecordId,
        third.sourceCandidateRecordId,
      ]);
      const [resumedCheckpointRows] = await harness.pool.execute<
        Array<RowDataPacket & { lastSourceId: number; processedCount: number }>
      >(
        `SELECT last_source_id AS lastSourceId, processed_count AS processedCount
           FROM identity_backfill_checkpoint
           WHERE run_id = ? AND entity_type = 'candidate_record'`,
        [runId],
      );
      expect(resumedCheckpointRows.map(normalizeCheckpoint)).toEqual([
        { lastSourceId: third.sourceCandidateRecordId, processedCount: 3 },
      ]);
      await expectBackfilledLegacyModes(harness.pool, runId);
    });
  }, 120_000);
});

class FailOnceCandidateRepository extends CandidateIdentityRepository {
  private failurePending = true;

  constructor(private readonly failureSourceId: number) {
    super();
  }

  override async syncCandidateRecord(executor: SqlExecutor, sourceCandidateRecordId: number, sourceExamName: string) {
    if (this.failurePending && sourceCandidateRecordId === this.failureSourceId) {
      this.failurePending = false;
      throw new Error("synthetic checkpoint interruption");
    }
    return super.syncCandidateRecord(executor, sourceCandidateRecordId, sourceExamName);
  }
}

async function withCleanHarness(
  task: (harness: MariaDbIntegrationHarness, systemUserId: number) => Promise<void>,
): Promise<void> {
  const harness = await createMariaDbIntegrationHarness();
  try {
    const systemUserId = await clearSeedBusinessData(harness.pool);
    await task(harness, systemUserId);
  } finally {
    await harness.cleanup();
  }
}

async function clearSeedBusinessData(pool: Pool): Promise<number> {
  await pool.query("DELETE FROM pseudonym_assignment");
  await pool.query("DELETE FROM pseudonym_operation");
  await pool.query("DELETE FROM pseudonym_time_range");
  await pool.query("DELETE FROM pseudonym_setting");
  await pool.query("DELETE FROM user_admission_assignment");
  await pool.query("DELETE FROM examinee");

  const [systemRows] = await pool.query<Array<RowDataPacket & { id: number }>>(
    "SELECT id FROM app_user WHERE login_id = 'system' LIMIT 1",
  );
  const systemUserId = Number(systemRows[0]?.id ?? 0);
  if (!systemUserId) throw new Error("System integration user is missing.");
  await pool.execute(
    `UPDATE system_profile
     SET academic_year = 2044, examinee_no_uniqueness = 'SYSTEM',
         pseudonym_no_uniqueness = 'ADMISSION', updated_by = ?
     WHERE id = 1`,
    [systemUserId],
  );
  return systemUserId;
}

function createSchedule(overrides: Partial<LegacySchedule> = {}): LegacySchedule {
  return {
    admission: "Synthetic Admission",
    examDate: "2044-09-01",
    startTime: "09:00",
    endTime: "10:00",
    periodName: "Synthetic Period",
    periodCode: "SYNTHETIC-1",
    unitName: "Synthetic Unit",
    buildingName: "Synthetic Building",
    roomName: "Synthetic Room",
    ...overrides,
  };
}

async function insertSourceCandidate(pool: Pool, input: SourceCandidateInput): Promise<SourceCandidateFixture> {
  const [examineeResult] = await pool.execute<ResultSetHeader>(
    `INSERT INTO examinee
      (examinee_no, name, exam_name, exam_date, room_name, seat_no, label_barcode)
     VALUES (?, ?, ?, ?, ?, '01', ?)`,
    [
      input.examineeNo,
      input.name,
      examName,
      input.schedule.examDate,
      input.schedule.roomName,
      `IT-${digestHex(input.examineeNo).slice(0, 24)}`,
    ],
  );
  const sourceCandidateRecordId = await insertCandidateRecord(pool, input);
  return { examineeId: Number(examineeResult.insertId), sourceCandidateRecordId };
}

async function insertCandidateRecord(pool: Pool, input: SourceCandidateInput): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO candidate_record
      (admission, admission_code, unit_name, unit_code, exam_date, start_time, end_time,
       period_name, period_code, building_name, building_code, room_name, room_code,
       examinee_no, name, birth_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.schedule.admission,
      "SYNTHETIC-ADMISSION",
      input.schedule.unitName,
      "SYNTHETIC-UNIT",
      input.schedule.examDate,
      input.schedule.startTime,
      input.schedule.endTime,
      input.schedule.periodName,
      input.schedule.periodCode,
      input.schedule.buildingName,
      "SYNTHETIC-BUILDING",
      input.schedule.roomName,
      "SYNTHETIC-ROOM",
      input.examineeNo,
      input.name,
      input.birthDate,
    ],
  );
  return Number(result.insertId);
}

async function insertCandidatePhoto(
  pool: Pool,
  sourceCandidateRecordId: number,
  contentValue = "synthetic-candidate-photo",
): Promise<void> {
  const content = Buffer.from(contentValue);
  await pool.execute(
    `INSERT INTO candidate_photo
      (candidate_record_id, file_name, mime_type, content, content_hash)
     VALUES (?, 'synthetic.png', 'image/png', ?, ?)`,
    [sourceCandidateRecordId, content, createHash("sha256").update(content).digest("hex")],
  );
}

async function insertSetting(
  pool: Pool,
  systemUserId: number,
  admission: string,
  rangeStart: number,
  rangeEnd: number,
  assignmentMethod: "DRAW" | "SEQUENTIAL" | "MATCHING" | "PREASSIGNED" = "SEQUENTIAL",
): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO pseudonym_setting
      (exam_name, admission_name, range_start, range_end, next_sequence,
       assignment_method, active, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, TRUE, ?)`,
    [examName, admission, rangeStart, rangeEnd, rangeStart, assignmentMethod, systemUserId],
  );
  return Number(result.insertId);
}

async function insertTimeRange(
  pool: Pool,
  systemUserId: number,
  settingId: number,
  schedule: LegacySchedule,
  rangeStart: number,
  rangeEnd: number,
): Promise<number> {
  const scheduleKey = digestHex(
    [
      schedule.examDate,
      schedule.startTime,
      schedule.periodName,
      schedule.admission,
      schedule.unitName,
      "",
      schedule.buildingName,
      schedule.roomName,
    ].join("|"),
  );
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO pseudonym_time_range
      (setting_id, exam_date, exam_time, period_name, admission, unit_name, major,
       building_name, room_name, schedule_key, range_start, range_end, next_sequence, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
    [
      settingId,
      schedule.examDate,
      schedule.startTime,
      schedule.periodName,
      schedule.admission,
      schedule.unitName,
      schedule.buildingName,
      schedule.roomName,
      scheduleKey,
      rangeStart,
      rangeEnd,
      rangeStart,
      systemUserId,
    ],
  );
  return Number(result.insertId);
}

async function insertClosedOperation(pool: Pool, systemUserId: number, schedule: LegacySchedule): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO pseudonym_operation
      (exam_name, exam_date, exam_time, period_name, admission_name,
       closed, closed_by, closed_at)
     VALUES (?, ?, ?, ?, ?, TRUE, ?, '2044-09-01 10:00:00.000')`,
    [examName, schedule.examDate, schedule.startTime, schedule.periodName, schedule.admission, systemUserId],
  );
  return Number(result.insertId);
}

async function insertAssignment(
  pool: Pool,
  input: {
    systemUserId: number;
    examineeId: number;
    sourceCandidateRecordId: number;
    admission: string;
    pseudonymNo: string;
  },
): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO pseudonym_assignment
      (examinee_id, candidate_record_id, exam_name, admission_name,
       uniqueness_scope_key, pseudonym_no, assignment_mode, assigned_by, assigned_at)
     VALUES (?, ?, ?, ?, ?, ?, 'MANUAL', ?, '2044-09-01 09:15:00.000')`,
    [
      input.examineeId,
      input.sourceCandidateRecordId,
      examName,
      input.admission,
      digestHex(`legacy-assignment:${input.sourceCandidateRecordId}`),
      input.pseudonymNo,
      input.systemUserId,
    ],
  );
  return Number(result.insertId);
}

async function insertOrphanAssignment(
  pool: Pool,
  systemUserId: number,
  admission: string,
  pseudonymNo: string,
  legacyExamName = `${examName} Legacy`,
): Promise<number> {
  const examineeNo = `ORPHAN-${randomUUID()}`;
  const [examinee] = await pool.execute<ResultSetHeader>(
    `INSERT INTO examinee
      (examinee_no, name, exam_name, exam_date, room_name, seat_no, label_barcode)
     VALUES (?, 'Synthetic Preserved Orphan', ?, '2044-09-01', 'Legacy Room', '00', ?)`,
    [examineeNo, legacyExamName, `IT-${digestHex(examineeNo).slice(0, 24)}`],
  );
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO pseudonym_assignment
      (examinee_id, candidate_record_id, exam_name, admission_name,
       uniqueness_scope_key, pseudonym_no, assignment_mode, assigned_by, assigned_at)
     VALUES (?, NULL, ?, ?, ?, ?, 'MANUAL', ?, '2044-09-01 09:16:00.000')`,
    [
      Number(examinee.insertId),
      legacyExamName,
      admission,
      digestHex(`legacy-orphan:${randomUUID()}`),
      pseudonymNo,
      systemUserId,
    ],
  );
  return Number(result.insertId);
}

async function insertScopedOperator(pool: Pool, admission: string): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO app_user (login_id, password_hash, role, enabled)
     VALUES (?, NULL, 'OPERATOR', TRUE)`,
    [`identity-backfill-${randomUUID()}`],
  );
  const userId = Number(result.insertId);
  await pool.execute(`INSERT INTO user_admission_assignment (user_id, admission_name) VALUES (?, ?)`, [
    userId,
    admission,
  ]);
  return userId;
}

async function insertUnrestrictedUserWithLegacyScope(
  pool: Pool,
  role: "ADMIN" | "DEVELOPER",
  admission: string,
): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO app_user (login_id, password_hash, role, enabled)
     VALUES (?, NULL, ?, TRUE)`,
    [`identity-backfill-${role.toLowerCase()}-${randomUUID()}`, role],
  );
  const userId = Number(result.insertId);
  await pool.execute(`INSERT INTO user_admission_assignment (user_id, admission_name) VALUES (?, ?)`, [
    userId,
    admission,
  ]);
  return userId;
}

async function insertPrintJob(pool: Pool, systemUserId: number): Promise<string> {
  const [fixtureRows] = await pool.query<Array<RowDataPacket & { templateId: number; workstationId: number }>>(
    `SELECT template.id AS templateId, workstation.id AS workstationId
     FROM label_template template
     INNER JOIN workstation ON workstation.code = 'WS-DEV-001'
     WHERE template.code = 'PRINTER_TEST' AND template.version = 1 LIMIT 1`,
  );
  const fixture = fixtureRows[0];
  if (!fixture) throw new Error("Print integration fixtures are missing.");
  const printJobId = randomUUID();
  await pool.execute(
    `INSERT INTO print_job
      (id, job_no, label_type, business_ref, template_id, template_version,
       workstation_id, requested_by, idempotency_key, request_fingerprint,
       copies, status, expires_at)
     VALUES (?, ?, 'PSEUDONYM_LABEL', 'synthetic-backfill', ?, 1, ?, ?, ?, ?,
             1, 'READY', DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY))`,
    [
      printJobId,
      `IDENTITY-BACKFILL-${randomUUID()}`,
      fixture.templateId,
      fixture.workstationId,
      systemUserId,
      randomUUID(),
      digestHex(`print:${printJobId}`),
    ],
  );
  await pool.execute(
    `INSERT INTO print_job_payload (print_job_id, format, payload)
     VALUES (?, 'ZPL', '^XA^FDSYNTHETIC BACKFILL^FS^XZ')`,
    [printJobId],
  );
  return printJobId;
}

async function runBackfill(
  harness: MariaDbIntegrationHarness,
  service: IdentityBackfillService,
  options: Omit<IdentityBackfillOptions, "confirmIsolatedCopy">,
): Promise<IdentityBackfillReport> {
  const connection = await harness.pool.getConnection();
  try {
    return await service.run(connection, { ...options, confirmIsolatedCopy: true });
  } finally {
    connection.release();
  }
}

async function loadTargetCounts(pool: Pool): Promise<TargetCounts> {
  const [rows] = await pool.query<
    Array<
      RowDataPacket & {
        candidates: number;
        registrations: number;
        candidatePhotos: number;
        assignments: number;
        operationEvents: number;
        assignmentEvents: number;
        printSnapshots: number;
        accountScopes: number;
      }
    >
  >(
    `SELECT (SELECT COUNT(*) FROM candidate) AS candidates,
            (SELECT COUNT(*) FROM candidate_registration) AS registrations,
            (SELECT COUNT(*) FROM candidate_identity_photo) AS candidatePhotos,
            (SELECT COUNT(*) FROM candidate_pseudonym_assignment) AS assignments,
            (SELECT COUNT(*) FROM pseudonym_operation_event) AS operationEvents,
            (SELECT COUNT(*) FROM pseudonym_assignment_event) AS assignmentEvents,
            (SELECT COUNT(*) FROM print_projection_snapshot) AS printSnapshots,
            (SELECT COUNT(*) FROM user_admission_scope_assignment) AS accountScopes`,
  );
  const row = rows[0];
  if (!row) throw new Error("Target count query returned no row.");
  return {
    candidates: Number(row.candidates),
    registrations: Number(row.registrations),
    candidatePhotos: Number(row.candidatePhotos),
    assignments: Number(row.assignments),
    operationEvents: Number(row.operationEvents),
    assignmentEvents: Number(row.assignmentEvents),
    printSnapshots: Number(row.printSnapshots),
    accountScopes: Number(row.accountScopes),
  };
}

async function targetRegistrationSourceIds(pool: Pool): Promise<number[]> {
  const [rows] = await pool.query<Array<RowDataPacket & { sourceCandidateRecordId: number }>>(
    `SELECT source_candidate_record_id AS sourceCandidateRecordId
     FROM candidate_registration ORDER BY source_candidate_record_id`,
  );
  return rows.map((row) => Number(row.sourceCandidateRecordId));
}

async function expectBackfilledLegacyModes(pool: Pool, runId: string): Promise<void> {
  await expectTransitionState(pool, runId, "BACKFILLED");
}

async function expectBlockedLegacyModes(pool: Pool, runId: string): Promise<void> {
  await expectTransitionState(pool, runId, "BLOCKED");
}

async function expectTransitionState(pool: Pool, runId: string, phase: string): Promise<void> {
  const [rows] = await pool.query<
    Array<RowDataPacket & { phase: string; writeMode: string; readMode: string; lastBackfillRunId: string }>
  >(
    `SELECT phase, write_mode AS writeMode, read_mode AS readMode,
            last_backfill_run_id AS lastBackfillRunId
     FROM identity_transition_state WHERE id = 1`,
  );
  expect(rows).toEqual([
    {
      phase,
      writeMode: "LEGACY",
      readMode: "LEGACY",
      lastBackfillRunId: runId,
    },
  ]);
}

function normalizeCheckpoint(row: RowDataPacket & { lastSourceId: number; processedCount: number }) {
  return {
    lastSourceId: Number(row.lastSourceId),
    processedCount: Number(row.processedCount),
  };
}

function digestHex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
