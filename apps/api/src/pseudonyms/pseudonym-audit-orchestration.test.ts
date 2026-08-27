import { BadRequestException } from "@nestjs/common";
import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import type { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { AssignPseudonymUseCase, ChangePseudonymOperationStatusUseCase } from "./pseudonyms.application.js";
import type { CandidateRow, PseudonymsRepository, SettingRow } from "./pseudonyms.repository.js";
import type { AssignPseudonymInput, PseudonymOperationScopeInput } from "./pseudonyms.types.js";

describe("pseudonym application audit orchestration", () => {
  it("records a new assignment after the repository write and before commit", async () => {
    const fixture = createAssignmentFixture();

    await expect(fixture.useCase.execute(assignmentInput(), actor)).resolves.toMatchObject({
      id: 42,
      pseudonymNumber: "1201",
      alreadyAssigned: false,
    });

    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.connection, {
      eventType: "PSEUDONYM_ASSIGNED",
      actorUserId: actor.id,
      details: {
        assignmentId: 42,
        candidateRecordId: 208,
        examineeNo: "10001",
        pseudonymNo: "1201",
        mode: "MANUAL",
      },
    });
    expect(fixture.repository.insertAssignment.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.audit.record.mock.invocationCallOrder[0],
    );
    expect(fixture.audit.record.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fixture.connection.commit).mock.invocationCallOrder[0],
    );
  });

  it("rolls back assignment writes when the application audit fails", async () => {
    const fixture = createAssignmentFixture();
    const auditFailure = new Error("audit unavailable");
    fixture.audit.record.mockRejectedValue(auditFailure);

    await expect(fixture.useCase.execute(assignmentInput(), actor)).rejects.toBe(auditFailure);

    expect(fixture.repository.insertAssignment).toHaveBeenCalledOnce();
    expect(fixture.connection.rollback).toHaveBeenCalledOnce();
    expect(fixture.connection.commit).not.toHaveBeenCalled();
  });

  it("maps pure assignment validation errors back to the existing HTTP bad-request contract", async () => {
    const fixture = createAssignmentFixture();

    await expect(
      fixture.useCase.execute(assignmentInput({ manualNumber: "not-a-number" }), actor),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fixture.connection.rollback).toHaveBeenCalledOnce();
    expect(fixture.audit.record).not.toHaveBeenCalled();
  });

  it("records close and reopen events inside their respective transactions", async () => {
    const closeFixture = createOperationFixture();

    await closeFixture.useCase.close(operationScope, actor);

    expect(closeFixture.audit.record).toHaveBeenCalledWith(closeFixture.connection, {
      eventType: "PSEUDONYM_OPERATION_CLOSED",
      actorUserId: actor.id,
      details: { operationId: 7, ...operationDetails, autoAssignedAbsenteeCount: 0 },
    });
    expect(closeFixture.repository.closeOperation.mock.invocationCallOrder[0]).toBeLessThan(
      closeFixture.audit.record.mock.invocationCallOrder[0],
    );
    expect(closeFixture.audit.record.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(closeFixture.connection.commit).mock.invocationCallOrder[0],
    );

    const reopenFixture = createOperationFixture();
    await reopenFixture.useCase.reopen(operationScope, actor);

    expect(reopenFixture.audit.record).toHaveBeenCalledWith(reopenFixture.connection, {
      eventType: "PSEUDONYM_OPERATION_REOPENED",
      actorUserId: actor.id,
      details: { operationId: 7, ...operationDetails, deletedAbsenteeCount: 0 },
    });
    expect(reopenFixture.repository.reopenOperation.mock.invocationCallOrder[0]).toBeLessThan(
      reopenFixture.audit.record.mock.invocationCallOrder[0],
    );
    expect(reopenFixture.audit.record.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(reopenFixture.connection.commit).mock.invocationCallOrder[0],
    );
  });
});

const actor = { id: 7, loginId: "admin", role: "ADMIN" as const, admissionNames: [] };

const operationScope: PseudonymOperationScopeInput = {
  examName: "2026학년도",
  examDate: "2026-09-01",
  examTime: "09:00",
  periodName: "1교시",
  admissionName: "일반전형",
};

const operationDetails = {
  examDate: operationScope.examDate,
  examTime: operationScope.examTime,
  periodName: operationScope.periodName,
  admissionName: operationScope.admissionName,
};

function createConnection() {
  return {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  } as unknown as PoolConnection;
}

function createAssignmentFixture() {
  const connection = createConnection();
  const candidate = candidateRow();
  const repository = {
    loadPseudonymNumberPolicyForUpdate: vi.fn().mockResolvedValue("ADMISSION"),
    findCandidateInScope: vi.fn().mockResolvedValue(candidate),
    ensureOperation: vi.fn().mockResolvedValue(undefined),
    lockOperation: vi.fn().mockResolvedValue({ id: 7, closed: false }),
    findSetting: vi.fn().mockResolvedValue(settingRow()),
    findAssignmentForUpdate: vi.fn().mockResolvedValue(undefined),
    loadReservedNumbers: vi.fn().mockResolvedValue(new Set<number>()),
    findPreassignedOwner: vi.fn().mockResolvedValue(null),
    insertAssignment: vi.fn().mockResolvedValue(42),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;
  const useCase = new AssignPseudonymUseCase(
    pool,
    repository as unknown as PseudonymsRepository,
    audit as unknown as MutationAuditRepository,
  );
  return { audit, connection, repository, useCase };
}

function createOperationFixture() {
  const connection = createConnection();
  const repository = {
    loadPseudonymNumberPolicyForUpdate: vi.fn().mockResolvedValue("ADMISSION"),
    ensureOperation: vi.fn().mockResolvedValue(undefined),
    lockOperation: vi.fn().mockResolvedValue({ id: 7, closed: false }),
    findOperationForUpdate: vi.fn().mockResolvedValue({ id: 7, closed: true }),
    findSetting: vi.fn().mockResolvedValue(settingRow()),
    closeOperation: vi.fn().mockResolvedValue(undefined),
    reopenOperation: vi.fn().mockResolvedValue(undefined),
    findOperationStatus: vi.fn().mockResolvedValue({ closed: false, closedAt: null, closedByLoginId: null }),
    countAutoAssignedAbsentees: vi.fn().mockResolvedValue(0),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;
  const useCase = new ChangePseudonymOperationStatusUseCase(
    pool,
    repository as unknown as PseudonymsRepository,
    audit as unknown as MutationAuditRepository,
  );
  return { audit, connection, repository, useCase };
}

function assignmentInput(overrides: Partial<AssignPseudonymInput> = {}): AssignPseudonymInput {
  return {
    ...operationScope,
    examineeNo: "10001",
    mode: "MANUAL",
    manualNumber: "1201",
    ...overrides,
  };
}

function candidateRow(): CandidateRow {
  return {
    id: 8,
    candidateRecordId: 208,
    examineeNo: "10001",
    name: "일정별 수험생",
    examName: operationScope.examName,
    preassignedNumber: null,
    examDate: operationScope.examDate,
    examTime: operationScope.examTime,
    period: operationScope.periodName,
    admission: operationScope.admissionName,
    unit: "디자인",
    major: "시각디자인",
    building: "예술관",
    room: "202호",
  } as CandidateRow;
}

function settingRow(): SettingRow {
  return {
    id: 9,
    version: 3,
    examName: operationScope.examName,
    admissionName: operationScope.admissionName,
    rangeStart: 1001,
    rangeEnd: 1300,
    nextSequence: 1001,
    assignmentMethod: "MATCHING",
    autoDrawEnabled: false,
    autoDrawDelaySeconds: 3,
    printPreassignedLabel: false,
    autoAssignAbsenteesOnClose: false,
    deleteAbsenteeInfoOnReopen: false,
    useCandidatePhotos: false,
    enableBulkDraw: false,
  } as SettingRow;
}
