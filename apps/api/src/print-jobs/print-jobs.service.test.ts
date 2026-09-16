import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import type { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { resolveAppConfig } from "../config/app-config.js";
import { createPrintJobRequestFingerprint } from "./print-job-idempotency.js";
import type { CreatePrintJobDto } from "./print-jobs.dto.js";
import type { PrintJobsRepository } from "./print-jobs.repository.js";
import { PrintJobsService, resolvePrintJobExpirySeconds } from "./print-jobs.service.js";

const input: CreatePrintJobDto = {
  idempotencyKey: "5f4955d9-4625-4b24-802f-f4f19b60c422",
  examineeNo: "10001",
  examName: "2026년도 자격시험",
  workstationCode: "GT800-01",
  copies: 1,
  examDate: "2026-08-11",
  examTime: "09:00",
  periodName: "1교시",
  admissionName: "배정 전형",
};

const operator: AuthenticatedUser = {
  id: 7,
  loginId: "operator",
  role: "OPERATOR",
  admissionNames: ["배정 전형"],
};

const koreanLabelLayout = {
  widthMm: 75,
  heightMm: 45,
  dpi: 203,
  elements: [
    {
      id: "pseudonym",
      kind: "text",
      xMm: 4,
      yMm: 4,
      widthMm: 67,
      heightMm: 12,
      content: "{{candidate.temporaryNo}}",
      fontSizeMm: 9,
      align: "center",
    },
    {
      id: "candidate-name",
      kind: "text",
      xMm: 4,
      yMm: 20,
      widthMm: 67,
      heightMm: 7,
      content: "수험생 {{candidate.name}}",
      fontSizeMm: 4,
      align: "center",
    },
  ],
};

describe("PrintJobsService", () => {
  it("대기실명 태그를 라벨 출력 데이터에 연결한다", async () => {
    const connection = createConnectionMock();
    const repository = createRepositoryMock({
      findActiveLabelTemplate: vi.fn().mockResolvedValue({
        id: 3,
        layout: null,
        zplTemplate: "^XA^FD{{CANDIDATE_WAITING_ROOM_NAME}}^FS^XZ",
      }),
    });
    const result = await createService(connection, repository).create(input, operator);
    expect(result.payload).toContain("WAIT-201");
    expect(result.payload).not.toContain("{{CANDIDATE_WAITING_ROOM_NAME}}");
  });

  it("rejects a candidate with a recorded print timestamp before returning or creating a job", async () => {
    const connection = createConnectionMock();
    const repository = createRepositoryMock({ hasPrintedLabel: vi.fn().mockResolvedValue(true) });
    await expect(createService(connection, repository).create(input, operator)).rejects.toThrow(
      "이미 출력된 수험생은 라벨을 재출력할 수 없습니다.",
    );
    expect(repository.findByIdempotencyKey).not.toHaveBeenCalled();
    expect(repository.insertPrintJob).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
  it("rejects an admission outside the operator scope before opening a transaction", async () => {
    const getConnection = vi.fn();
    const service = new PrintJobsService(
      { getConnection } as unknown as Pool,
      resolveAppConfig({ PRINT_JOB_EXPIRY_SECONDS: "300" }),
    );

    await expect(service.create({ ...input, admissionName: "다른 전형" }, operator)).rejects.toThrow(
      "배정되지 않은 전형의 라벨은 출력할 수 없습니다.",
    );
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("creates a label job from the consolidated candidate record", async () => {
    const connection = createConnectionMock();
    const repository = createRepositoryMock();
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = createService(connection, repository, audit);

    const result = await service.create(input, operator);

    expect(result).toMatchObject({ status: "READY", copies: 1, format: "ZPL" });
    expect(result.payload).toContain("8201");
    expect(result.payload).toContain("^GFA");
    expect(result.payload).not.toContain("김수험");
    expect(repository.findAssignedExamName).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({ examineeNo: "10001", admissionName: "배정 전형" }),
      "2026년도 자격시험",
    );
    expect(repository.findCandidateForUpdate).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({ examineeNo: "10001", admissionName: "배정 전형" }),
    );
    expect(repository.findActiveLabelTemplate).toHaveBeenCalledWith(connection, 9);
    expect(repository.insertPrintJob).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({
        businessReference: "10001",
        candidateRecordId: 202,
        requestedBy: 7,
        expirySeconds: 300,
      }),
    );
    expect(repository.insertPayload).toHaveBeenCalledWith(connection, result.id, result.payload);
    expect(audit.record).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({ eventType: "PRINT_JOB_CREATED", printJobId: result.id }),
    );
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it("returns the existing job when an idempotency key has the same request", async () => {
    const connection = createConnectionMock();
    const response = {
      id: "job-existing",
      jobNo: "PJ-EXISTING",
      status: "READY" as const,
      copies: 1,
      format: "ZPL",
      payload: "^XA^XZ",
    };
    const repository = createRepositoryMock({
      findByIdempotencyKey: vi.fn().mockResolvedValue({
        requestFingerprint: createPrintJobRequestFingerprint(input),
        response,
      }),
    });
    const service = createService(connection, repository);

    await expect(service.create(input, operator)).resolves.toEqual(response);
    expect(repository.insertPrintJob).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it("expires a ready job whose validity period has elapsed", async () => {
    const connection = createConnectionMock();
    const repository = createRepositoryMock({
      findJobForUpdate: vi.fn().mockResolvedValue({
        requestedBy: operator.id,
        workstationId: 4,
        status: "READY",
        isExpired: 1,
      }),
    });
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = createService(connection, repository, audit);

    await expect(service.complete("job-1", { status: "SENT" }, operator)).resolves.toEqual({
      id: "job-1",
      status: "EXPIRED",
    });
    expect(repository.markExpired).toHaveBeenCalledWith(connection, "job-1");
    expect(repository.markSent).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(connection, expect.objectContaining({ eventType: "PRINT_JOB_EXPIRED" }));
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it("records a failed printer transfer", async () => {
    const connection = createConnectionMock();
    const repository = createRepositoryMock({
      findJobForUpdate: vi.fn().mockResolvedValue({
        requestedBy: operator.id,
        workstationId: 4,
        status: "READY",
        isExpired: 0,
      }),
    });
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = createService(connection, repository, audit);

    await expect(service.complete("job-2", { status: "FAILED", errorMessage: "연결 실패" }, operator)).resolves.toEqual(
      { id: "job-2", status: "FAILED" },
    );
    expect(repository.markFailed).toHaveBeenCalledWith(connection, "job-2", "연결 실패");
    expect(audit.record).toHaveBeenCalledWith(connection, expect.objectContaining({ eventType: "PRINT_JOB_FAILED" }));
  });
});

describe("resolvePrintJobExpirySeconds", () => {
  it("uses the configured value and safe default", () => {
    expect(resolvePrintJobExpirySeconds("120")).toBe(120);
    expect(resolvePrintJobExpirySeconds(undefined)).toBe(300);
    expect(() => resolvePrintJobExpirySeconds("not-a-number")).toThrow("must be a positive integer");
  });
});

function createService(
  connection: ReturnType<typeof createConnectionMock>,
  repository = createRepositoryMock(),
  audit: Pick<MutationAuditRepository, "record"> = { record: vi.fn().mockResolvedValue(undefined) },
) {
  return new PrintJobsService(
    { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool,
    resolveAppConfig({ PRINT_JOB_EXPIRY_SECONDS: "300" }),
    audit as MutationAuditRepository,
    repository,
  );
}

function createConnectionMock() {
  return {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  } as unknown as PoolConnection & {
    beginTransaction: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };
}

function createRepositoryMock(overrides: Partial<Record<keyof PrintJobsRepository, ReturnType<typeof vi.fn>>> = {}) {
  return {
    findAssignedExamName: vi.fn().mockResolvedValue(input.examName),
    findPrintPolicyForUpdate: vi.fn().mockResolvedValue({
      assignmentMethod: "PREASSIGNED",
      printPreassignedLabel: 1,
      labelTemplateId: 9,
    }),
    findByIdempotencyKey: vi.fn().mockResolvedValue(null),
    hasPrintedLabel: vi.fn().mockResolvedValue(false),
    findCandidateForUpdate: vi.fn().mockResolvedValue({
      candidateRecordId: 202,
      examineeNo: input.examineeNo,
      candidateName: "김수험",
      birthDate: "2008-07-24",
      examName: input.examName,
      examDate: input.examDate,
      examStartTime: input.examTime,
      examEndTime: "10:00",
      periodName: input.periodName,
      admissionName: input.admissionName,
      admissionCode: "ADM-1",
      unitName: "유아교육과",
      majorName: "유아교육",
      buildingName: "사범관",
      roomName: "202호",
      waitingRoom: "WAIT-201",
      seatNo: "22",
      groupName: "1조",
      opt1: "추가정보1",
      opt2: "추가정보2",
      opt3: "추가정보3",
      labelBarcode: "EX10001",
      preassignedNumber: "8201",
      pseudonymNumber: "8201",
      absent: false,
      schoolName: "한국대학교",
      academicYear: 2026,
      systemName: "가번호 관리 시스템",
      roomAssignedCount: 24,
      roomPresentCount: 22,
      roomAbsentCount: 2,
    }),
    findActiveLabelTemplate: vi.fn().mockResolvedValue({
      id: 3,
      zplTemplate: "^XA^FD{{CANDIDATE_TEMPORARY_NO}}/{{CANDIDATE_NAME}}/{{SCHOOL_NAME}}^FS^XZ",
      layout: koreanLabelLayout,
    }),
    findEnabledWorkstationId: vi.fn().mockResolvedValue(4),
    insertPrintJob: vi.fn().mockResolvedValue(undefined),
    insertPayload: vi.fn().mockResolvedValue(undefined),
    findJobForUpdate: vi.fn().mockResolvedValue(null),
    markExpired: vi.fn().mockResolvedValue(undefined),
    markSent: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as PrintJobsRepository;
}
