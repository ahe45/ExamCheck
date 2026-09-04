import { BadRequestException } from "@nestjs/common";
import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import type { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { resolveAppConfig } from "../config/app-config.js";
import type { CandidatePhotoArchiveFiles } from "./candidate-domain.js";
import { candidateKey, type CandidateInput } from "./candidate-fields.js";
import { CandidatesApplicationService } from "./candidates.application.js";
import type { CandidatesRepository } from "./candidates.repository.js";

describe("CandidatesApplicationService", () => {
  it("uses one transaction connection for workbook writes and the safe audit record", async () => {
    const fixture = createFixture();
    fixture.repository.loadExamineeNumberUniqueness.mockResolvedValue("SYSTEM");
    fixture.repository.loadExisting.mockResolvedValue(new Map());
    fixture.repository.insertCandidate.mockResolvedValue(91);

    await expect(
      fixture.application.importCandidates([candidate()], "insert-update", "workbook-sha256", 7),
    ).resolves.toEqual({ totalRows: 1, inserted: 1, updated: 0, skipped: 0 });

    expect(fixture.repository.loadExamineeNumberUniqueness).toHaveBeenCalledWith(fixture.connection, {
      forUpdate: true,
    });
    expect(fixture.repository.loadExisting).toHaveBeenCalledWith(fixture.connection, { forUpdate: true });
    expect(fixture.repository.listOperationallyProtectedCandidateIds).toHaveBeenCalledWith(
      fixture.connection,
      [],
      "테스트 시험",
    );
    expect(fixture.repository.listImportScopeGuards).toHaveBeenCalledWith(fixture.connection, "테스트 시험");
    expect(fixture.repository.insertCandidate).toHaveBeenCalledWith(fixture.connection, candidate(), "테스트 시험");
    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.connection, {
      eventType: "CANDIDATE_WORKBOOK_IMPORTED",
      actorUserId: 7,
      details: {
        totalRows: 1,
        inserted: 1,
        updated: 0,
        skipped: 0,
        policy: "insert-update",
        checksum: "workbook-sha256",
      },
    });
    expect(fixture.audit.record.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fixture.connection.commit).mock.invocationCallOrder[0],
    );
    expect(fixture.connection.commit).toHaveBeenCalledOnce();
  });

  it("rolls back workbook writes when the audit record fails", async () => {
    const fixture = createFixture();
    const auditFailure = new Error("audit unavailable");
    fixture.repository.loadExamineeNumberUniqueness.mockResolvedValue("SYSTEM");
    fixture.repository.loadExisting.mockResolvedValue(new Map());
    fixture.repository.insertCandidate.mockResolvedValue(91);
    fixture.audit.record.mockRejectedValue(auditFailure);

    await expect(fixture.application.importCandidates([candidate()], "all", "workbook-sha256", null)).rejects.toBe(
      auditFailure,
    );

    expect(fixture.connection.rollback).toHaveBeenCalledOnce();
    expect(fixture.connection.commit).not.toHaveBeenCalled();
    expect(fixture.connection.release).toHaveBeenCalledOnce();
  });

  it("maps pure candidate validation errors back to the existing HTTP bad-request contract", async () => {
    const fixture = createFixture();
    fixture.repository.loadExamineeNumberUniqueness.mockResolvedValue("SYSTEM");
    fixture.repository.loadExisting.mockResolvedValue(new Map());

    await expect(
      fixture.application.importCandidates([candidate(), candidate()], "insert-update", "workbook-sha256", 7),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fixture.connection.rollback).toHaveBeenCalledOnce();
    expect(fixture.repository.insertCandidate).not.toHaveBeenCalled();
  });

  it("rejects a workbook commit when locked candidate state changed after preview", async () => {
    const fixture = createFixture();
    fixture.repository.loadExamineeNumberUniqueness.mockResolvedValue("SYSTEM");
    fixture.repository.loadExisting.mockResolvedValue(new Map());

    await expect(
      fixture.application.importCandidates([candidate()], "insert-update", "workbook-sha256", 7, "0".repeat(64)),
    ).rejects.toThrow("미리보기 이후 수험생 데이터가 변경되었습니다");

    expect(fixture.repository.insertCandidate).not.toHaveBeenCalled();
    expect(fixture.audit.record).not.toHaveBeenCalled();
    expect(fixture.connection.rollback).toHaveBeenCalledOnce();
  });

  it("rejects assignment-critical reuploads once a candidate schedule is protected", async () => {
    const fixture = createFixture();
    const current = { ...candidate(), id: 11 };
    fixture.repository.loadExamineeNumberUniqueness.mockResolvedValue("SYSTEM");
    fixture.repository.loadExisting.mockResolvedValue(new Map([[candidateKey(current), current]]));
    fixture.repository.listOperationallyProtectedCandidateIds.mockResolvedValue(new Set([11]));

    await expect(
      fixture.application.importCandidates(
        [candidate({ admission: "특별전형" })],
        "insert-update",
        "workbook-sha256",
        7,
      ),
    ).rejects.toThrow("가번호 배정 또는 마감 이력이 있는 수험생 1명");

    expect(fixture.repository.updateCandidate).not.toHaveBeenCalled();
    expect(fixture.audit.record).not.toHaveBeenCalled();
    expect(fixture.connection.rollback).toHaveBeenCalledOnce();
  });

  it("allows ordinary profile corrections for a protected candidate", async () => {
    const fixture = createFixture();
    const current = { ...candidate(), id: 11 };
    const corrected = candidate({ name: "이름 정정" });
    fixture.repository.loadExamineeNumberUniqueness.mockResolvedValue("SYSTEM");
    fixture.repository.loadExisting.mockResolvedValue(new Map([[candidateKey(current), current]]));

    await expect(
      fixture.application.importCandidates([corrected], "insert-update", "workbook-sha256", 7),
    ).resolves.toMatchObject({ updated: 1 });

    expect(fixture.repository.listOperationallyProtectedCandidateIds).toHaveBeenCalledWith(
      fixture.connection,
      [],
      "테스트 시험",
    );
    expect(fixture.repository.updateCandidate).toHaveBeenCalledWith(fixture.connection, 11, corrected, "테스트 시험");
    expect(fixture.repository.listImportScopeGuards).not.toHaveBeenCalled();
  });

  it("rejects inserts into a closed operation before writing candidate data", async () => {
    const fixture = createFixture();
    fixture.repository.loadExamineeNumberUniqueness.mockResolvedValue("SYSTEM");
    fixture.repository.loadExisting.mockResolvedValue(new Map());
    fixture.repository.listImportScopeGuards.mockResolvedValue([scopeGuard("CLOSED")]);

    await expect(
      fixture.application.importCandidates([candidate()], "insert-update", "workbook-sha256", 7),
    ).rejects.toThrow("등록 완료(마감)된 전형·교시 1곳");

    expect(fixture.repository.insertCandidate).not.toHaveBeenCalled();
    expect(fixture.connection.rollback).toHaveBeenCalledOnce();
  });

  it("clears configured ranges affected by newly uploaded candidate data", async () => {
    const fixture = createFixture();
    fixture.repository.loadExamineeNumberUniqueness.mockResolvedValue("SYSTEM");
    fixture.repository.loadExisting.mockResolvedValue(new Map());
    fixture.repository.listImportScopeGuards.mockResolvedValue([scopeGuard("RANGE")]);

    await expect(
      fixture.application.importCandidates([candidate()], "insert-update", "workbook-sha256", 7),
    ).resolves.toMatchObject({ inserted: 1 });

    expect(fixture.repository.deleteTimeRangesByIds).toHaveBeenCalledWith(fixture.connection, [91]);
    expect(fixture.repository.insertCandidate).toHaveBeenCalledOnce();
    expect(fixture.connection.commit).toHaveBeenCalledOnce();
  });

  it("clears both previous and next range scopes when an upload moves a candidate", async () => {
    const fixture = createFixture();
    const current = { ...candidate(), id: 11 };
    const moved = candidate({ admission: "특별전형", room: "202호" });
    fixture.repository.loadExamineeNumberUniqueness.mockResolvedValue("SYSTEM");
    fixture.repository.loadExisting.mockResolvedValue(new Map([[candidateKey(current), current]]));
    fixture.repository.listImportScopeGuards.mockResolvedValue([
      scopeGuard("RANGE"),
      { ...scopeGuard("RANGE"), rangeId: 92, admission: "특별전형", room: "202호" },
    ]);

    await expect(
      fixture.application.importCandidates([moved], "insert-update", "workbook-sha256", 7),
    ).resolves.toMatchObject({ updated: 1 });

    expect(fixture.repository.deleteTimeRangesByIds).toHaveBeenCalledWith(fixture.connection, [91, 92]);
    expect(fixture.repository.updateCandidate).toHaveBeenCalledWith(fixture.connection, 11, moved, "테스트 시험");
  });

  it("locks photo state, writes with the same connection, and excludes PII and bytes from audit details", async () => {
    const fixture = createFixture();
    fixture.repository.listCandidatePhotos.mockResolvedValue([{ id: 11, examineeNo: "10001", photoHash: null }]);
    const archive: CandidatePhotoArchiveFiles = {
      files: [
        {
          fileName: "10001.png",
          mimeType: "image/png",
          content: Buffer.from("private-photo-bytes"),
          contentHash: "photo-sha256",
        },
      ],
      totalFiles: 1,
      skippedCount: 0,
    };

    await expect(
      fixture.application.importCandidatePhotos(archive, "insert-update", "archive-sha256", 7),
    ).resolves.toEqual({ totalFiles: 1, uploaded: 1, updated: 0, skipped: 0, duplicateCount: 0 });

    expect(fixture.repository.listCandidatePhotos).toHaveBeenCalledWith(fixture.connection, { forUpdate: true });
    expect(fixture.repository.upsertCandidatePhoto).toHaveBeenCalledWith(
      fixture.connection,
      11,
      expect.objectContaining({ fileName: "10001.png", content: Buffer.from("private-photo-bytes") }),
    );
    const auditRecord = fixture.audit.record.mock.calls[0]?.[1];
    expect(auditRecord).toEqual({
      eventType: "CANDIDATE_PHOTO_ARCHIVE_IMPORTED",
      actorUserId: 7,
      details: {
        totalFiles: 1,
        uploaded: 1,
        updated: 0,
        skipped: 0,
        duplicateCount: 0,
        policy: "insert-update",
        checksum: "archive-sha256",
      },
    });
    expect(JSON.stringify(auditRecord?.details)).not.toContain("10001");
    expect(JSON.stringify(auditRecord?.details)).not.toContain("private-photo-bytes");
    expect(JSON.stringify(auditRecord?.details)).not.toContain(".png");
  });

  it("rolls back photo writes when their audit record cannot be stored", async () => {
    const fixture = createFixture();
    const auditFailure = new Error("audit unavailable");
    fixture.repository.listCandidatePhotos.mockResolvedValue([{ id: 11, examineeNo: "10001", photoHash: null }]);
    fixture.audit.record.mockRejectedValue(auditFailure);

    await expect(
      fixture.application.importCandidatePhotos(
        {
          files: [
            {
              fileName: "10001.png",
              mimeType: "image/png",
              content: Buffer.from("private-photo-bytes"),
              contentHash: "photo-sha256",
            },
          ],
          totalFiles: 1,
          skippedCount: 0,
        },
        "all",
        "archive-sha256",
        7,
      ),
    ).rejects.toBe(auditFailure);

    expect(fixture.repository.upsertCandidatePhoto).toHaveBeenCalledOnce();
    expect(fixture.connection.rollback).toHaveBeenCalledOnce();
    expect(fixture.connection.commit).not.toHaveBeenCalled();
  });

  it("rejects a photo commit when locked photo state changed after preview", async () => {
    const fixture = createFixture();
    fixture.repository.listCandidatePhotos.mockResolvedValue([
      { id: 11, examineeNo: "10001", photoHash: "changed-after-preview" },
    ]);

    await expect(
      fixture.application.importCandidatePhotos(
        { files: [], totalFiles: 0, skippedCount: 0 },
        "insert-update",
        "archive-sha256",
        7,
        "0".repeat(64),
      ),
    ).rejects.toThrow("미리보기 이후 수험생 데이터가 변경되었습니다");

    expect(fixture.repository.upsertCandidatePhoto).not.toHaveBeenCalled();
    expect(fixture.audit.record).not.toHaveBeenCalled();
    expect(fixture.connection.rollback).toHaveBeenCalledOnce();
  });
});

function createFixture() {
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  } as unknown as PoolConnection;
  const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;
  const repository = {
    list: vi.fn(),
    loadExisting: vi.fn(),
    loadExamineeNumberUniqueness: vi.fn(),
    listOperationallyProtectedCandidateIds: vi.fn().mockResolvedValue(new Set()),
    listImportScopeGuards: vi.fn().mockResolvedValue([]),
    deleteTimeRangesByIds: vi.fn().mockResolvedValue(0),
    insertCandidate: vi.fn(),
    updateCandidate: vi.fn(),
    listCandidatePhotos: vi.fn(),
    upsertCandidatePhoto: vi.fn(),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const config = resolveAppConfig({ DEFAULT_EXAM_NAME: "테스트 시험" });
  const application = new CandidatesApplicationService(
    pool,
    repository as unknown as CandidatesRepository,
    audit as unknown as MutationAuditRepository,
    config,
  );
  return { application, audit, connection, pool, repository };
}

function scopeGuard(guardType: "RANGE" | "CLOSED") {
  return {
    rangeId: guardType === "RANGE" ? 91 : null,
    guardType,
    date: "2026-09-01",
    time: "09:00",
    period: "1교시",
    admission: "일반전형",
    unit: guardType === "RANGE" ? "디자인학부" : "",
    major: "",
    building: guardType === "RANGE" ? "본관" : "",
    room: guardType === "RANGE" ? "101호" : "",
  };
}

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    designatedSort: "",
    date: "2026-09-01",
    time: "09:00",
    period: "1교시",
    admission: "일반전형",
    unit: "디자인학부",
    major: "",
    building: "본관",
    waitingRoom: "본관 대기실",
    room: "101호",
    examineeNo: "10001",
    temporaryNo: "",
    name: "홍길동",
    birth: "2000-01-01",
    group: "",
    opt1: "",
    opt2: "",
    opt3: "",
    ...overrides,
  };
}
