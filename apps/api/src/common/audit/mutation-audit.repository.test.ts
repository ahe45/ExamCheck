import { describe, expect, it, vi } from "vitest";
import type { SqlExecutor } from "../database/sql-executor.js";
import { runWithRequestContext } from "../http/request-context.js";
import { MutationAuditContractError } from "./mutation-audit.contract.js";
import { MutationAuditRepository, type MutationAuditRecord } from "./mutation-audit.repository.js";

const checksum = "a".repeat(64);

const validRecords: MutationAuditRecord[] = [
  {
    eventType: "ACCOUNT_CREATED",
    actorUserId: 1,
    details: { userId: 7, loginId: "operator", role: "USER" },
  },
  {
    eventType: "ACCOUNT_UPDATED",
    actorUserId: 1,
    details: { userId: 7, loginId: "operator", role: "ADMIN", passwordChanged: true },
  },
  { eventType: "ACCOUNT_DELETED", actorUserId: 1, details: { userId: 7 } },
  {
    eventType: "CANDIDATE_WORKBOOK_IMPORTED",
    actorUserId: 1,
    details: { totalRows: 3, inserted: 1, updated: 1, skipped: 1, policy: "insert-update", checksum },
  },
  {
    eventType: "CANDIDATE_PHOTO_ARCHIVE_IMPORTED",
    actorUserId: 1,
    details: {
      totalFiles: 4,
      uploaded: 1,
      updated: 1,
      skipped: 1,
      duplicateCount: 1,
      policy: "all",
      checksum,
    },
  },
  {
    eventType: "SYSTEM_PROFILE_UPDATED",
    actorUserId: 1,
    details: {
      schoolName: "한국대학교",
      academicYear: 2026,
      systemName: "가번호 관리 시스템",
      examineeNoUniqueness: "SYSTEM",
      pseudonymNoUniqueness: "ADMISSION",
    },
  },
  {
    eventType: "SYSTEM_LOGO_UPDATED",
    actorUserId: 1,
    details: { fileName: "logo.png", mimeType: "image/png" },
  },
  { eventType: "SYSTEM_LOGO_REMOVED", actorUserId: 1, details: {} },
  { eventType: "DEVELOPER_PASSWORD_CHANGED", actorUserId: 1, details: { developerUserId: 1 } },
  {
    eventType: "WORKSTATION_CREATED",
    actorUserId: 1,
    workstationId: 4,
    details: { workstationId: 4, code: "GT800-01" },
  },
  {
    eventType: "FORM_TEMPLATE_SAVED",
    actorUserId: 1,
    details: { code: "CANDIDATE_LABEL", templateId: 2, active: true, riskCount: 0 },
  },
  {
    eventType: "FORM_TEMPLATE_METADATA_UPDATED",
    actorUserId: 1,
    details: { code: "CANDIDATE_LABEL", templateId: 12 },
  },
  {
    eventType: "FORM_TEMPLATE_DELETED",
    actorUserId: 1,
    details: { code: "CANDIDATE_LABEL", templateId: 12 },
  },
  {
    eventType: "PSEUDONYM_SETTING_UPDATED",
    actorUserId: 1,
    details: {
      settingId: 11,
      version: 3,
      assignmentMethod: "DRAW",
      rangeCount: 2,
      autoDrawEnabled: true,
      autoDrawDelaySeconds: 3,
      printPreassignedLabel: false,
      autoAssignAbsenteesOnClose: true,
      deleteAbsenteeInfoOnReopen: true,
      useCandidatePhotos: false,
      enableBulkDraw: false,
    },
  },
  {
    eventType: "PSEUDONYM_OPERATION_CLOSED",
    actorUserId: 1,
    details: {
      operationId: 21,
      examDate: "2026-08-28",
      examTime: "09:30",
      periodName: "1교시",
      admissionName: "학생부교과",
      autoAssignedAbsenteeCount: 2,
    },
  },
  {
    eventType: "PSEUDONYM_OPERATION_REOPENED",
    actorUserId: 1,
    details: {
      operationId: 21,
      examDate: "2026-08-28",
      examTime: "09:30",
      periodName: "1교시",
      admissionName: "학생부교과",
      deletedAbsenteeCount: 2,
    },
  },
  {
    eventType: "PSEUDONYM_OPERATIONS_RESET",
    actorUserId: 1,
    details: {
      admissionName: "학생부교과",
      scheduleCount: 2,
      deletedAssignmentCount: 20,
      deletedOperationCount: 2,
      resetRangeCount: 4,
    },
  },
  {
    eventType: "ADMISSION_DELETED",
    actorUserId: 1,
    details: {
      admissionName: "학생부교과",
      deletedCandidateCount: 30,
      deletedAssignmentCount: 20,
      deletedOperationCount: 2,
      deletedSettingCount: 1,
      deletedRangeCount: 4,
      deletedAccountAssignmentCount: 1,
    },
  },
  {
    eventType: "PSEUDONYM_ASSIGNED",
    actorUserId: 1,
    details: {
      assignmentId: 31,
      candidateRecordId: 41,
      mode: "RANDOM",
    },
  },
  {
    eventType: "PRINT_JOB_CREATED",
    actorUserId: 1,
    workstationId: 4,
    printJobId: "56070238-e738-446f-a8df-bbdb86e82451",
    details: { jobNo: "PJ-TEST-001", copies: 1 },
  },
  {
    eventType: "PRINT_JOB_SENT",
    actorUserId: 1,
    workstationId: 4,
    printJobId: "56070238-e738-446f-a8df-bbdb86e82451",
    details: { status: "SENT" },
  },
  {
    eventType: "PRINT_JOB_FAILED",
    actorUserId: 1,
    workstationId: 4,
    printJobId: "56070238-e738-446f-a8df-bbdb86e82451",
    details: { status: "FAILED", errorRecorded: true },
  },
  {
    eventType: "PRINT_JOB_EXPIRED",
    actorUserId: 1,
    workstationId: 4,
    printJobId: "56070238-e738-446f-a8df-bbdb86e82451",
    details: { requestedStatus: "SENT", status: "EXPIRED" },
  },
  {
    eventType: "PRINT_JOB_REISSUED",
    actorUserId: 1,
    workstationId: 4,
    printJobId: "56070238-e738-446f-a8df-bbdb86e82451",
    details: { reissueType: "RETRY", reasonCode: "CLIENT_SEND_RETRY" },
  },
];

describe("MutationAuditRepository", () => {
  it("writes the complete audit envelope through the executor supplied by the caller", async () => {
    const executor = { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]) };
    const repository = new MutationAuditRepository();

    await repository.record(executor as unknown as SqlExecutor, {
      eventType: "PRINT_JOB_CREATED",
      actorUserId: 1,
      workstationId: 4,
      printJobId: "56070238-e738-446f-a8df-bbdb86e82451",
      requestId: "request-123",
      details: { jobNo: "PJ-TEST-001", copies: 1 },
    });

    expect(executor.execute).toHaveBeenCalledWith(
      expect.stringMatching(/workstation_id, print_job_id, request_id, details/),
      [
        "PRINT_JOB_CREATED",
        1,
        4,
        "56070238-e738-446f-a8df-bbdb86e82451",
        "request-123",
        JSON.stringify({ jobNo: "PJ-TEST-001", copies: 1 }),
      ],
    );
  });

  it("stores absent optional envelope fields as SQL nulls", async () => {
    const executor = { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]) };
    const repository = new MutationAuditRepository();

    await repository.record(executor as unknown as SqlExecutor, {
      eventType: "ACCOUNT_DELETED",
      actorUserId: null,
      details: { userId: 7 },
    });

    expect(executor.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), [
      "ACCOUNT_DELETED",
      null,
      null,
      null,
      null,
      JSON.stringify({ userId: 7 }),
    ]);
  });

  it("rejects a reissue reason that does not match the retry or reprint type", async () => {
    const executor = { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]) };
    const repository = new MutationAuditRepository();

    await expect(
      repository.record(executor as unknown as SqlExecutor, {
        eventType: "PRINT_JOB_REISSUED",
        actorUserId: 1,
        workstationId: 4,
        printJobId: "56070238-e738-446f-a8df-bbdb86e82451",
        details: { reissueType: "RETRY", reasonCode: "LABEL_DAMAGED" },
      }),
    ).rejects.toBeInstanceOf(MutationAuditContractError);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("inherits the active HTTP request ID when the caller does not override it", async () => {
    const executor = { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]) };
    const repository = new MutationAuditRepository();

    await runWithRequestContext("request-from-context", () =>
      repository.record(executor as unknown as SqlExecutor, {
        eventType: "ACCOUNT_UPDATED",
        actorUserId: 1,
        details: { userId: 7, loginId: "operator", role: "USER", passwordChanged: false },
      }),
    );

    expect(executor.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), [
      "ACCOUNT_UPDATED",
      1,
      null,
      null,
      "request-from-context",
      JSON.stringify({ userId: 7, loginId: "operator", role: "USER", passwordChanged: false }),
    ]);
  });

  it.each(validRecords.map((record) => [record.eventType, record] as const))(
    "accepts and normalizes the documented %s event contract",
    async (_eventType, record) => {
      const executor = { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]) };
      const repository = new MutationAuditRepository();

      await repository.record(executor as unknown as SqlExecutor, record);

      expect(executor.execute).toHaveBeenCalledOnce();
      const parameters = executor.execute.mock.calls[0]?.[1] as unknown[];
      expect(JSON.parse(parameters[5] as string)).toEqual(record.details);
    },
  );

  it.each(validRecords.map((record) => [record.eventType, record] as const))(
    "rejects undocumented details for %s before executing SQL",
    async (_eventType, record) => {
      const executor = { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]) };
      const repository = new MutationAuditRepository();
      const invalid = {
        ...record,
        details: { ...record.details, passwordHash: "must-never-be-stored" },
      } as unknown as MutationAuditRecord;

      await expect(repository.record(executor as unknown as SqlExecutor, invalid)).rejects.toBeInstanceOf(
        MutationAuditContractError,
      );
      expect(executor.execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["candidate name", "PSEUDONYM_ASSIGNED", { name: "수험생 이름" }],
    ["photo payload", "CANDIDATE_PHOTO_ARCHIVE_IMPORTED", { photoBase64: "raw-photo" }],
    ["template layout", "FORM_TEMPLATE_SAVED", { layout: "<html>raw layout</html>" }],
    ["print payload", "PRINT_JOB_CREATED", { payload: "^XA raw zpl" }],
  ])("rejects a sensitive %s field even when attached to %s", async (_label, eventType, forbidden) => {
    const executor = { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]) };
    const repository = new MutationAuditRepository();
    const record = validRecords.find((candidate) => candidate.eventType === eventType);
    expect(record).toBeDefined();

    await expect(
      repository.record(
        executor as unknown as SqlExecutor,
        {
          ...record,
          details: { ...record?.details, ...forbidden },
        } as unknown as MutationAuditRecord,
      ),
    ).rejects.toBeInstanceOf(MutationAuditContractError);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("rejects invalid values in otherwise allowed fields", async () => {
    const executor = { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]) };
    const repository = new MutationAuditRepository();

    await expect(
      repository.record(
        executor as unknown as SqlExecutor,
        {
          eventType: "PSEUDONYM_ASSIGNED",
          actorUserId: 1,
          details: {
            assignmentId: 31,
            candidateRecordId: -1,
            mode: "RANDOM",
          },
        } as unknown as MutationAuditRecord,
      ),
    ).rejects.toBeInstanceOf(MutationAuditContractError);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a print event without its workstation and job correlation",
      { eventType: "PRINT_JOB_SENT", actorUserId: 1, details: { status: "SENT" } },
    ],
    [
      "a workstation event without its workstation correlation",
      {
        eventType: "WORKSTATION_CREATED",
        actorUserId: 1,
        details: { workstationId: 4, code: "GT800-01" },
      },
    ],
    [
      "an unrelated event with a forbidden correlation field",
      {
        eventType: "ACCOUNT_DELETED",
        actorUserId: 1,
        workstationId: null,
        details: { userId: 7 },
      },
    ],
    [
      "a workstation event whose envelope and details identify different rows",
      {
        eventType: "WORKSTATION_CREATED",
        actorUserId: 1,
        workstationId: 5,
        details: { workstationId: 4, code: "GT800-01" },
      },
    ],
  ])("rejects %s before executing SQL", async (_label, invalid) => {
    const executor = { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]) };
    const repository = new MutationAuditRepository();

    await expect(
      repository.record(executor as unknown as SqlExecutor, invalid as unknown as MutationAuditRecord),
    ).rejects.toBeInstanceOf(MutationAuditContractError);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it.each([
    [
      "workbook totals",
      {
        eventType: "CANDIDATE_WORKBOOK_IMPORTED",
        actorUserId: 1,
        details: { totalRows: 3, inserted: 2, updated: 1, skipped: 1, policy: "all", checksum },
      },
    ],
    [
      "photo totals",
      {
        eventType: "CANDIDATE_PHOTO_ARCHIVE_IMPORTED",
        actorUserId: 1,
        details: {
          totalFiles: 4,
          uploaded: 1,
          updated: 1,
          skipped: 1,
          duplicateCount: 2,
          policy: "all",
          checksum,
        },
      },
    ],
  ])("rejects inconsistent %s", async (_label, invalid) => {
    const executor = { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]) };
    const repository = new MutationAuditRepository();

    await expect(
      repository.record(executor as unknown as SqlExecutor, invalid as unknown as MutationAuditRecord),
    ).rejects.toBeInstanceOf(MutationAuditContractError);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("rejects a date-shaped value that is not a real calendar date", async () => {
    const executor = { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]) };
    const repository = new MutationAuditRepository();

    await expect(
      repository.record(executor as unknown as SqlExecutor, {
        eventType: "PSEUDONYM_OPERATION_CLOSED",
        actorUserId: 1,
        details: {
          operationId: 21,
          examDate: "2026-02-30",
          examTime: "09:30",
          periodName: "1교시",
          admissionName: "학생부교과",
          autoAssignedAbsenteeCount: 0,
        },
      }),
    ).rejects.toBeInstanceOf(MutationAuditContractError);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("rejects unrecognized events and envelope fields", async () => {
    const executor = { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]) };
    const repository = new MutationAuditRepository();

    await expect(
      repository.record(
        executor as unknown as SqlExecutor,
        {
          eventType: "ARBITRARY_EVENT",
          actorUserId: 1,
          authorization: "Bearer secret",
          details: {},
        } as unknown as MutationAuditRecord,
      ),
    ).rejects.toBeInstanceOf(MutationAuditContractError);
    expect(executor.execute).not.toHaveBeenCalled();
  });
});
