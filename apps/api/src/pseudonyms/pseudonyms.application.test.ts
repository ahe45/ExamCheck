import { ConflictException } from "@nestjs/common";
import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import type { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { UpdatePseudonymSettingUseCase } from "./pseudonyms.application.js";
import type { UpdatePseudonymSettingDto } from "./pseudonyms.dto.js";
import type { PseudonymsRepository, SettingRow } from "./pseudonyms.repository.js";

describe("UpdatePseudonymSettingUseCase audit boundary", () => {
  it("records a non-identifying audit event before committing the setting transaction", async () => {
    const fixture = createFixture();
    const input = settingInput();

    await expect(fixture.useCase.execute(input, actor)).resolves.toMatchObject({ version: 4 });

    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.connection, {
      eventType: "PSEUDONYM_SETTING_UPDATED",
      actorUserId: actor.id,
      details: {
        settingId: 9,
        version: 4,
        assignmentMethod: "MATCHING",
        rangeCount: 0,
        autoDrawEnabled: false,
        autoDrawDelaySeconds: 3,
        printPreassignedLabel: true,
        autoAssignAbsenteesOnClose: true,
        deleteAbsenteeInfoOnReopen: false,
        useCandidatePhotos: true,
        enableBulkDraw: false,
        showAttendanceSelection: true,
      },
    });
    const auditDetails = fixture.audit.record.mock.calls[0]?.[1].details;
    expect(JSON.stringify(auditDetails)).not.toContain(input.examName);
    expect(JSON.stringify(auditDetails)).not.toContain(input.admissionName);
    expect(fixture.repository.updateSetting.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.audit.record.mock.invocationCallOrder[0],
    );
    expect(fixture.audit.record.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fixture.connection.commit).mock.invocationCallOrder[0],
    );
    expect(fixture.connection.commit).toHaveBeenCalledOnce();
    expect(fixture.connection.rollback).not.toHaveBeenCalled();
  });

  it("rolls back the setting update when its audit event cannot be stored", async () => {
    const fixture = createFixture();
    const auditFailure = new Error("audit unavailable");
    fixture.audit.record.mockRejectedValue(auditFailure);

    await expect(fixture.useCase.execute(settingInput(), actor)).rejects.toBe(auditFailure);

    expect(fixture.repository.updateSetting).toHaveBeenCalledOnce();
    expect(fixture.connection.rollback).toHaveBeenCalledOnce();
    expect(fixture.connection.commit).not.toHaveBeenCalled();
    expect(fixture.connection.release).toHaveBeenCalledOnce();
    expect(fixture.repository.findSetting).not.toHaveBeenCalled();
  });

  it("maps a pure setting version conflict back to the existing HTTP conflict contract", async () => {
    const fixture = createFixture();

    await expect(fixture.useCase.execute(settingInput({ expectedVersion: 2 }), actor)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(fixture.connection.rollback).toHaveBeenCalledOnce();
    expect(fixture.repository.updateSetting).not.toHaveBeenCalled();
  });
});

const actor = { id: 7, loginId: "admin", role: "ADMIN" as const, admissionNames: [] };

function createFixture() {
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  } as unknown as PoolConnection;
  const setting = settingRow();
  const repository = {
    lockAdmissionNumbers: vi.fn(),
    insertAbsenteeAssignments: vi.fn().mockResolvedValue([1]),
    loadPseudonymNumberPolicyForUpdate: vi.fn().mockResolvedValue("ADMISSION"),
    findExactSettingForUpdate: vi.fn().mockResolvedValue(setting),
    listScheduleCounts: vi.fn().mockResolvedValue([]),
    listTimeRangesForUpdate: vi.fn().mockResolvedValue([]),
    listAssignmentScopesForUpdate: vi.fn().mockResolvedValue([]),
    updateSetting: vi.fn().mockResolvedValue(1),
    insertSetting: vi.fn(),
    upsertTimeRange: vi.fn(),
    deleteTimeRange: vi.fn(),
    findSetting: vi.fn().mockResolvedValue({ ...setting, version: 4 }),
    listTimeRanges: vi.fn().mockResolvedValue([]),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;
  const useCase = new UpdatePseudonymSettingUseCase(
    pool,
    repository as unknown as PseudonymsRepository,
    audit as unknown as MutationAuditRepository,
  );
  return { audit, connection, pool, repository, useCase };
}

function settingInput(overrides: Partial<UpdatePseudonymSettingDto> = {}): UpdatePseudonymSettingDto {
  return {
    expectedVersion: 3,
    examName: "감사에서 제외할 시험명",
    admissionName: "감사에서 제외할 전형명",
    rangeStart: 1,
    rangeEnd: 9999,
    assignmentMethod: "MATCHING",
    autoDrawEnabled: false,
    autoDrawDelaySeconds: 3,
    printPreassignedLabel: true,
    autoAssignAbsenteesOnClose: true,
    deleteAbsenteeInfoOnReopen: false,
    useCandidatePhotos: true,
    enableBulkDraw: false,
    ranges: [],
    ...overrides,
  };
}

function settingRow(): SettingRow {
  return {
    id: 9,
    version: 3,
    examName: "감사에서 제외할 시험명",
    admissionName: "감사에서 제외할 전형명",
    rangeStart: 1,
    rangeEnd: 9999,
    nextSequence: 7,
    assignmentMethod: "MATCHING",
    autoDrawEnabled: false,
    autoDrawDelaySeconds: 3,
    printPreassignedLabel: true,
    autoAssignAbsenteesOnClose: true,
    deleteAbsenteeInfoOnReopen: false,
    useCandidatePhotos: true,
    enableBulkDraw: false,
  } as SettingRow;
}

vi.mock("../common/database/transaction.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../common/database/transaction.js")>()),
  beginScopedWrite: async (connection: { beginTransaction(): Promise<void> }) => connection.beginTransaction(),
}));
