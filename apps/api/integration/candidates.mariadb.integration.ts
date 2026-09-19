import ExcelJS from "exceljs";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MutationAuditRepository } from "../src/common/audit/mutation-audit.repository.js";
import { MutationAuditRepository as AuditRepository } from "../src/common/audit/mutation-audit.repository.js";
import { runWithRequestContext } from "../src/common/http/request-context.js";
import type { CandidatePhotoArchiveFiles } from "../src/candidates/candidate-domain.js";
import { candidateFields, type CandidateInput } from "../src/candidates/candidate-fields.js";
import { CandidatesApplicationService } from "../src/candidates/candidates.application.js";
import { CandidatesRepository } from "../src/candidates/candidates.repository.js";
import { CandidatesService } from "../src/candidates/candidates.service.js";
import { resolveAppConfig } from "../src/config/app-config.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

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

describe("candidate import MariaDB integration", () => {
  it("commits workbook/photo data and their PII-free audit records atomically", async () => {
    const application = createApplication(new AuditRepository());
    const input = candidate("IT-CAND-SUCCESS");

    await expect(
      application.importCandidates([input], "insert-update", sha256Fixture("a"), actorUserId),
    ).resolves.toEqual({ totalRows: 1, inserted: 1, updated: 0, skipped: 0 });

    const [candidateRows] = await harness.pool.execute<Array<RowDataPacket & { id: number }>>(
      "SELECT id FROM candidate_record WHERE examinee_no = ?",
      [input.examineeNo],
    );
    expect(candidateRows).toHaveLength(1);

    const archive: CandidatePhotoArchiveFiles = {
      files: [
        {
          fileName: `${input.examineeNo}.png`,
          mimeType: "image/png",
          content: Buffer.from("validated-photo-content"),
          contentHash: sha256Fixture("b"),
        },
      ],
      totalFiles: 1,
      skippedCount: 0,
    };
    await expect(
      application.importCandidatePhotos(archive, "insert-update", sha256Fixture("c"), actorUserId),
    ).resolves.toEqual({ totalFiles: 1, uploaded: 1, updated: 0, skipped: 0, duplicateCount: 0 });

    const [photoRows] = await harness.pool.execute<Array<RowDataPacket & { contentHash: string }>>(
      "SELECT content_hash AS contentHash FROM candidate_photo WHERE candidate_record_id = ?",
      [candidateRows[0]!.id],
    );
    expect(photoRows).toEqual([{ contentHash: sha256Fixture("b") }]);

    const [auditRows] = await harness.pool.execute<Array<RowDataPacket & { eventType: string; details: string }>>(
      `SELECT event_type AS eventType, details FROM audit_log
       WHERE event_type IN ('CANDIDATE_WORKBOOK_IMPORTED', 'CANDIDATE_PHOTO_ARCHIVE_IMPORTED')
       ORDER BY id`,
    );
    expect(auditRows.map((row) => row.eventType)).toEqual([
      "CANDIDATE_WORKBOOK_IMPORTED",
      "CANDIDATE_PHOTO_ARCHIVE_IMPORTED",
    ]);
    for (const row of auditRows) {
      const details = typeof row.details === "string" ? row.details : JSON.stringify(row.details);
      expect(details).not.toContain(input.examineeNo);
      expect(details).not.toContain(input.name);
      expect(details).not.toContain("validated-photo-content");
      expect(Object.keys(JSON.parse(details)).sort()).toEqual(
        row.eventType === "CANDIDATE_WORKBOOK_IMPORTED"
          ? ["checksum", "inserted", "policy", "skipped", "totalRows", "updated"].sort()
          : ["checksum", "duplicateCount", "policy", "skipped", "totalFiles", "updated", "uploaded"].sort(),
      );
    }
  });

  it("round-trips every workbook field through insert, update and API reads", async () => {
    const repository = new CandidatesRepository();
    const application = createApplication(new AuditRepository(), repository);
    const config = resolveAppConfig({ DEFAULT_EXAM_NAME: "IT 수험생 업로드 시험" });
    const service = new CandidatesService(harness.pool, repository, application, config);
    const inserted = candidate("IT-CAND-FIELD-MAP", {
      designatedSort: "71",
      date: "2039-12-01",
      time: "14:35",
      period: "필드 검증 교시",
      admission: "필드 검증 전형",
      unit: "필드 검증 모집단위",
      major: "필드 검증 전공",
      building: "필드 검증관",
      waitingRoom: "필드 검증 대기실",
      room: "필드 검증실",
      temporaryNo: "TMP-71",
      name: "필드검증 수험생",
      birth: "2001-12-31",
      group: "검증 1조",
      opt1: "선택값 1",
      opt2: "선택값 2",
      opt3: "선택값 3",
    });

    const insertedWorkbook = await workbookBuffer(inserted);
    const insertedPreview = await service.preview(insertedWorkbook, "inserted.xlsx", actorUserId);
    await expect(
      service.import(insertedWorkbook, "insert-update", insertedPreview.previewToken, actorUserId),
    ).resolves.toMatchObject({
      inserted: 1,
      updated: 0,
    });
    expect(candidateFieldsFrom(await findCandidate(service, inserted.examineeNo))).toEqual(inserted);

    const updated: CandidateInput = {
      ...inserted,
      designatedSort: "72",
      admission: "수정 필드 검증 전형",
      unit: "수정 필드 검증 모집단위",
      major: "수정 필드 검증 전공",
      building: inserted.building,
      waitingRoom: "수정 필드 검증 대기실",
      room: "수정 필드 검증실",
      temporaryNo: "TMP-72",
      name: "수정된 필드검증 수험생",
      birth: "2002-11-30",
      group: "검증 2조",
      opt1: "수정 선택값 1",
      opt2: "수정 선택값 2",
      opt3: "수정 선택값 3",
    };
    const updatedWorkbook = await workbookBuffer(updated);
    const updatedPreview = await service.preview(updatedWorkbook, "updated.xlsx", actorUserId);
    await expect(
      service.import(updatedWorkbook, "all", updatedPreview.previewToken, actorUserId),
    ).resolves.toMatchObject({
      inserted: 0,
      updated: 1,
    });
    expect(candidateFieldsFrom(await findCandidate(service, updated.examineeNo))).toEqual(updated);
  });

  it("persists the maximum accepted 128-character request ID with a mutation audit", async () => {
    const requestId = "r".repeat(128);
    const input = candidate("IT-CAND-REQUEST-ID");

    await expect(
      runWithRequestContext(requestId, () =>
        createApplication(new AuditRepository()).importCandidates(
          [input],
          "insert-update",
          sha256Fixture("e"),
          actorUserId,
        ),
      ),
    ).resolves.toMatchObject({ inserted: 1 });

    const [auditRows] = await harness.pool.execute<Array<RowDataPacket & { requestId: string }>>(
      `SELECT request_id AS requestId
         FROM audit_log
        WHERE event_type = 'CANDIDATE_WORKBOOK_IMPORTED'
          AND request_id = ?`,
      [requestId],
    );
    expect(auditRows).toEqual([{ requestId }]);
  });

  it("rolls candidate and operational rows back when audit storage fails", async () => {
    const failure = new Error("forced audit failure");
    const audit = { record: vi.fn().mockRejectedValue(failure) };
    const application = createApplication(audit as unknown as MutationAuditRepository);
    const input = candidate("IT-CAND-ROLLBACK");

    await expect(application.importCandidates([input], "all", "rollback-checksum", actorUserId)).rejects.toBe(failure);

    const [counts] = await harness.pool.execute<Array<RowDataPacket & { candidateCount: number }>>(
      `SELECT COUNT(*) AS candidateCount FROM candidate_record WHERE examinee_no = ?`,
      [input.examineeNo],
    );
    expect(Number(counts[0]?.candidateCount)).toBe(0);
    expect(audit.record).toHaveBeenCalledOnce();
  });

  it("rejects a candidate insert into a closed operation", async () => {
    const input = candidate("IT-CAND-CLOSED", {
      date: "2039-10-01",
      admission: "IT 마감 전형",
    });
    await harness.pool.execute(
      `INSERT INTO pseudonym_operation
        (exam_name, exam_date, exam_time, period_name, admission_name, closed, closed_by, closed_at)
       VALUES ('IT 수험생 업로드 시험', ?, ?, ?, ?, TRUE, ?, NOW(3))`,
      [input.date, input.time, input.period, input.admission, actorUserId],
    );

    await expect(
      createApplication(new AuditRepository()).importCandidates(
        [input],
        "insert-update",
        "closed-checksum",
        actorUserId,
      ),
    ).rejects.toThrow("등록 완료(마감)된 전형·교시 1곳");

    await expect(candidateCount(input.examineeNo)).resolves.toBe(0);
  });

  it("accepts a candidate insert and clears the configured range affected by the new data", async () => {
    const input = candidate("IT-CAND-RANGE", {
      date: "2039-10-02",
      admission: "IT 범위 전형",
    });
    const [setting] = await harness.pool.execute<ResultSetHeader>(
      `INSERT INTO pseudonym_setting
        (exam_name, admission_name, range_start, range_end, display_width, next_sequence, updated_by)
       VALUES ('IT 수험생 업로드 시험', ?, 8101, 8101, 4, 8101, ?)`,
      [input.admission, actorUserId],
    );
    await harness.pool.execute(
      `INSERT INTO pseudonym_time_range
        (setting_id, exam_date, exam_time, period_name, admission, unit_name, major,
         building_name, room_name, schedule_key, range_start, range_end, display_width, next_sequence, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
               SHA2(CONCAT_WS('|', ?, ?, ?, ?, ?, ?, ?, ?), 256), 8101, 8101, 4, 8101, ?)`,
      [
        setting.insertId,
        input.date,
        input.time,
        input.period,
        input.admission,
        input.unit,
        input.major,
        input.building,
        input.room,
        input.date,
        input.time,
        input.period,
        input.admission,
        input.unit,
        input.major,
        input.building,
        input.room,
        actorUserId,
      ],
    );

    await expect(
      createApplication(new AuditRepository()).importCandidates(
        [input],
        "insert-update",
        sha256Fixture("f"),
        actorUserId,
      ),
    ).resolves.toMatchObject({ inserted: 1 });

    await expect(candidateCount(input.examineeNo)).resolves.toBe(1);
    const [rangeRows] = await harness.pool.execute<Array<RowDataPacket & { total: number }>>(
      "SELECT COUNT(*) AS total FROM pseudonym_time_range WHERE setting_id = ?",
      [setting.insertId],
    );
    expect(Number(rangeRows[0]?.total ?? 0)).toBe(0);
  });

  it("serializes imports behind the shared profile lock used by operational mutations", async () => {
    const input = candidate("IT-CAND-LOCK", {
      date: "2039-11-01",
      admission: "IT 잠금 전형",
    });
    const blocker = await harness.pool.getConnection();
    await blocker.beginTransaction();
    await blocker.execute("SELECT id FROM system_profile WHERE id = 1 FOR UPDATE");
    const importPromise = createApplication(new AuditRepository()).importCandidates(
      [input],
      "insert-update",
      sha256Fixture("d"),
      actorUserId,
    );
    try {
      const earlyState = await Promise.race([
        importPromise.then(
          () => "completed",
          () => "failed",
        ),
        new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 120)),
      ]);
      expect(earlyState).toBe("pending");
    } finally {
      await blocker.rollback();
      blocker.release();
    }

    await expect(importPromise).resolves.toMatchObject({ inserted: 1 });
    await expect(candidateCount(input.examineeNo)).resolves.toBe(1);
  });
});

function createApplication(audit: MutationAuditRepository, repository = new CandidatesRepository()) {
  return new CandidatesApplicationService(
    harness.pool,
    repository,
    audit,
    resolveAppConfig({ DEFAULT_EXAM_NAME: "IT 수험생 업로드 시험" }),
  );
}

function sha256Fixture(character: string): string {
  return character.repeat(64);
}

async function workbookBuffer(input: CandidateInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("수험생등록_양식");
  worksheet.addRow(candidateFields.map((field) => field.label));
  worksheet.addRow(candidateFields.map((field) => input[field.key]));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function findCandidate(service: CandidatesService, examineeNo: string) {
  const row = (await service.list()).find((candidateRow) => candidateRow.examineeNo === examineeNo);
  if (!row) throw new Error(`Candidate ${examineeNo} was not returned by the API service.`);
  return row;
}

function candidateFieldsFrom(row: CandidateInput): CandidateInput {
  return Object.fromEntries(candidateFields.map((field) => [field.key, row[field.key]])) as CandidateInput;
}

async function candidateCount(examineeNo: string) {
  const [rows] = await harness.pool.execute<Array<RowDataPacket & { count: number }>>(
    "SELECT COUNT(*) AS count FROM candidate_record WHERE examinee_no = ?",
    [examineeNo],
  );
  return Number(rows[0]?.count ?? 0);
}

function candidate(examineeNo: string, overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    designatedSort: "1",
    date: "2039-09-01",
    time: "09:00",
    period: "1교시",
    admission: "IT 수험생 전형",
    unit: "IT 모집단위",
    major: "IT 전공",
    building: "IT관",
    waitingRoom: "IT 대기실",
    room: "IT-101",
    examineeNo,
    temporaryNo: "",
    name: "통합검증 수험생",
    birth: "2000-01-01",
    group: "1조",
    opt1: "",
    opt2: "",
    opt3: "",
    ...overrides,
  };
}
