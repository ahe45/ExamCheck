import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import type { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { resolveAppConfig } from "../config/app-config.js";
import { IdentityBackfillProjectionRepository } from "../database/identity-backfill-projection.repository.js";
import type {
  IdentityTransitionCoordinator,
  IdentityWriteDecision,
} from "../identity-transition/identity-transition-coordinator.js";
import { createPrintJobRequestFingerprint } from "./print-job-idempotency.js";
import type { CompletePrintJobDto, CreatePrintJobDto } from "./print-jobs.dto.js";
import type { PrintJobsRepository } from "./print-jobs.repository.js";
import { PrintJobsService, resolvePrintJobExpirySeconds } from "./print-jobs.service.js";

const idempotencyKey = "5f4955d9-4625-4b24-802f-f4f19b60c422";
const input: CreatePrintJobDto = {
  idempotencyKey,
  examineeNo: "10001",
  examName: "2026년도 자격시험",
  workstationCode: "GT800-01",
  copies: 1,
  examDate: "2026-08-11",
  examTime: "09:00",
  periodName: "1교시",
  admissionName: "배정 전형",
};
const enabledPrintPolicy = {
  assignmentMethod: "PREASSIGNED",
  printPreassignedLabel: 1,
} as const;
const assignedExamName = { examName: input.examName } as const;
const operator: AuthenticatedUser = {
  id: 7,
  loginId: "operator",
  role: "OPERATOR",
  admissionNames: ["배정 전형"],
};

describe("PrintJobsService admission authorization", () => {
  it("rejects printing outside the assigned admission before opening a transaction", async () => {
    const getConnection = vi.fn();
    const service = new PrintJobsService(
      { getConnection } as unknown as Pool,
      resolveAppConfig({ PRINT_JOB_EXPIRY_SECONDS: "300" }),
    );

    await expect(
      service.create(
        {
          idempotencyKey,
          examineeNo: "10001",
          workstationCode: "GT800-01",
          copies: 1,
          examDate: "2026-08-11",
          examTime: "09:00",
          periodName: "1교시",
          admissionName: "다른 전형",
        },
        {
          id: 7,
          loginId: "operator",
          role: "OPERATOR",
          admissionNames: ["배정 전형"],
        },
      ),
    ).rejects.toThrow("배정되지 않은 전형의 라벨은 출력할 수 없습니다.");
    expect(getConnection).not.toHaveBeenCalled();
  });
});

describe("PrintJobsService idempotency request binding", () => {
  it("returns the original job only when the stored request fingerprint matches", async () => {
    const storedJob = printJobRow(createPrintJobRequestFingerprint(input));
    const connection = createConnectionMock({
      execute: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT pa.exam_name AS examName")) return [[assignedExamName], []];
        if (sql.includes("FROM pseudonym_setting")) return [[enabledPrintPolicy], []];
        if (sql.includes("FROM print_job pj")) return [[storedJob], []];
        throw new Error(`Unexpected SQL in test: ${sql}`);
      }),
    });
    const service = createService(connection);

    await expect(service.create(input, operator)).resolves.toEqual(printJobResponse(storedJob));
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it("rejects an existing key whose stored request fingerprint is different", async () => {
    const connection = createConnectionMock({
      execute: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT pa.exam_name AS examName")) return [[assignedExamName], []];
        if (sql.includes("FROM pseudonym_setting")) return [[enabledPrintPolicy], []];
        if (sql.includes("FROM print_job pj")) {
          return [[printJobRow(createPrintJobRequestFingerprint({ ...input, copies: 2 }))], []];
        }
        throw new Error(`Unexpected SQL in test: ${sql}`);
      }),
    });
    const service = createService(connection);

    await expect(service.create(input, operator)).rejects.toThrow("새 요청 키로 다시 시도해 주세요.");
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("rechecks the request fingerprint after a duplicate-entry race", async () => {
    let idempotencyLookups = 0;
    const storedJob = printJobRow(createPrintJobRequestFingerprint({ ...input, copies: 2 }));
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT pa.exam_name AS examName")) return [[assignedExamName], []];
      if (sql.includes("FROM pseudonym_setting")) return [[enabledPrintPolicy], []];
      if (sql.includes("FROM print_job pj")) {
        idempotencyLookups += 1;
        return idempotencyLookups === 1 ? [[], []] : [[storedJob], []];
      }
      if (sql.includes("FROM candidate_record cr")) {
        return [
          [
            {
              candidateRecordId: 1,
              examineeNo: input.examineeNo,
              examDate: input.examDate,
              roomName: "101호",
              seatNo: "1",
              labelBarcode: "10001",
              pseudonymNumber: "9001",
            },
          ],
          [],
        ];
      }
      if (sql.includes("FROM workstation")) return [[{ id: 1 }], []];
      if (sql.includes("INSERT INTO print_job")) {
        throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    });
    const connection = createConnectionMock({
      execute,
      query: vi.fn().mockResolvedValue([[{ id: 1, version: 1, zplTemplate: "^XA^FD{{PSEUDONYM_NO}}^FS^XZ" }], []]),
    });
    const service = createService(connection);

    await expect(service.create(input, operator)).rejects.toThrow("새 요청 키로 다시 시도해 주세요.");
    expect(idempotencyLookups).toBe(2);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});

describe("PrintJobsService schedule candidate projection", () => {
  it("renders label data from the exact candidate_record schedule", async () => {
    let candidateSql = "";
    let candidateParameters: unknown[] | undefined;
    const execute = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes("SELECT pa.exam_name AS examName")) return [[assignedExamName], []];
      if (sql.includes("FROM pseudonym_setting")) return [[enabledPrintPolicy], []];
      if (sql.includes("FROM print_job pj")) return [[], []];
      if (sql.includes("FROM candidate_record cr")) {
        candidateSql = sql;
        candidateParameters = parameters;
        return [
          [
            {
              candidateRecordId: 202,
              examineeNo: input.examineeNo,
              examDate: input.examDate,
              roomName: "일정별 202호",
              seatNo: "22",
              labelBarcode: "EX10001",
              pseudonymNumber: "8201",
            },
          ],
          [],
        ];
      }
      if (sql.includes("FROM workstation")) return [[{ id: 1 }], []];
      if (sql.includes("INSERT INTO print_job")) return [{ insertId: 1 }, []];
      if (sql.includes("INSERT INTO print_job_payload")) return [{ affectedRows: 1 }, []];
      if (sql.includes("INSERT INTO audit_log")) return [{ affectedRows: 1 }, []];
      throw new Error(`Unexpected SQL in test: ${sql}`);
    });
    const connection = createConnectionMock({
      execute,
      query: vi.fn().mockResolvedValue([
        [
          {
            id: 1,
            version: 1,
            zplTemplate: "^XA^FD{{PSEUDONYM_NO}}|{{EXAMINEE_NO}}|{{ROOM_NAME}}|{{SEAT_NO}}|{{EXAM_DATE}}^FS^XZ",
          },
        ],
        [],
      ]),
    });
    const audit = { record: vi.fn().mockResolvedValue(undefined) };

    const result = await createService(connection, audit as unknown as MutationAuditRepository).create(input, operator);

    expect(result.payload).toBe("^XA^FD8201|10001|일정별 202호|22|2026-08-11^FS^XZ");
    expect(candidateSql).toContain("cr.id AS candidateRecordId");
    expect(candidateSql).toContain("cr.room_name AS roomName");
    expect(candidateSql).toContain("COALESCE(cr.designated_sort");
    expect(candidateSql).not.toContain("e.room_name");
    expect(candidateSql).not.toContain("e.seat_no");
    expect(candidateParameters).toEqual([
      input.examineeNo,
      input.examDate,
      input.examTime,
      input.periodName,
      input.admissionName,
    ]);
    expect(audit.record).toHaveBeenCalledWith(connection, {
      eventType: "PRINT_JOB_CREATED",
      actorUserId: operator.id,
      workstationId: 1,
      printJobId: result.id,
      details: { jobNo: result.jobNo, copies: input.copies },
    });
  });

  it("keeps legacy create free of target-table access when transition support is disabled", async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT pa.exam_name AS examName")) return [[assignedExamName], []];
      if (sql.includes("FROM pseudonym_setting")) return [[enabledPrintPolicy], []];
      if (sql.includes("FROM print_job pj")) return [[], []];
      if (sql.includes("FROM candidate_record cr")) {
        return [
          [
            {
              candidateRecordId: 202,
              examineeNo: input.examineeNo,
              examDate: input.examDate,
              roomName: "202호",
              seatNo: "22",
              labelBarcode: "EX10001",
              pseudonymNumber: "8201",
            },
          ],
          [],
        ];
      }
      if (sql.includes("FROM workstation")) return [[{ id: 4 }], []];
      if (sql.includes("INSERT INTO print_job")) return [{ affectedRows: 1 }, []];
      if (sql.includes("INSERT INTO print_job_payload")) return [{ affectedRows: 1 }, []];
      throw new Error(`Unexpected SQL in legacy compatibility test: ${sql}`);
    });
    const connection = createConnectionMock({
      execute,
      query: vi.fn().mockResolvedValue([[{ id: 5, version: 2, zplTemplate: "^XA^FD{{PSEUDONYM_NO}}^FS^XZ" }], []]),
    });
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const identityProjection = { syncPrintSnapshot: vi.fn().mockResolvedValue(undefined) };
    const identityTransition = legacyWriteCoordinator();

    await expect(
      createService(
        connection,
        audit as unknown as MutationAuditRepository,
        undefined,
        identityProjection as unknown as IdentityBackfillProjectionRepository,
        identityTransition,
        false,
      ).create(input, operator),
    ).resolves.toMatchObject({ status: "READY", format: "ZPL" });

    expect(identityTransition.decideWrite).toHaveBeenCalledWith(connection);
    expect(identityProjection.syncPrintSnapshot).not.toHaveBeenCalled();
    const executedSql = execute.mock.calls.map((call) => String(call[0])).join("\n");
    expect(executedSql).not.toContain("identity_transition_state");
    expect(executedSql).not.toContain("print_projection_snapshot");
    expect(executedSql).not.toContain("candidate_registration");
  });

  it("fails closed before legacy lookups when the transition no longer permits legacy writes", async () => {
    const connection = createConnectionMock({});
    const repository = { findAssignedExamName: vi.fn() } as unknown as PrintJobsRepository;

    await expect(
      createService(connection, undefined, repository, undefined, canonicalWriteCoordinator(), true).create(
        input,
        operator,
      ),
    ).rejects.toThrow("레거시 출력 생성이 허용된 전환 상태");

    expect(repository.findAssignedExamName).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});

describe("PrintJobsService audit transaction executor", () => {
  it("joins the transition-state lock before reading or mutating a print job completion", async () => {
    const events: string[] = [];
    const connection = createConnectionMock({
      beginTransaction: vi.fn(async () => events.push("begin")),
      commit: vi.fn(async () => events.push("commit")),
      release: vi.fn(() => events.push("release")),
    });
    const repository = {
      findJobForUpdate: vi.fn(async () => {
        events.push("job");
        return { requestedBy: operator.id, workstationId: 9, status: "READY", isExpired: 0 };
      }),
      markSent: vi.fn(async () => events.push("sent")),
    } as unknown as PrintJobsRepository;
    const audit = { record: vi.fn(async () => events.push("audit")) };
    const identityTransition = targetWriteCoordinator(() => events.push("transition"));

    await createService(
      connection,
      audit as unknown as MutationAuditRepository,
      repository,
      undefined,
      identityTransition,
    ).complete("00000000-0000-4000-8000-000000000098", { status: "SENT" }, operator);

    expect(events).toEqual(["begin", "transition", "job", "sent", "audit", "commit", "release"]);
  });

  it("records sent, failed and expired results with the same connection that owns the status change", async () => {
    const scenarios: Array<{
      input: CompletePrintJobDto;
      expired: number;
      eventType: string;
      details: Record<string, unknown>;
    }> = [
      { input: { status: "SENT" }, expired: 0, eventType: "PRINT_JOB_SENT", details: { status: "SENT" } },
      {
        input: { status: "FAILED", errorMessage: "전송 실패" },
        expired: 0,
        eventType: "PRINT_JOB_FAILED",
        details: { status: "FAILED", errorRecorded: true },
      },
      {
        input: { status: "SENT" },
        expired: 1,
        eventType: "PRINT_JOB_EXPIRED",
        details: { requestedStatus: "SENT", status: "EXPIRED" },
      },
    ];

    for (const [index, scenario] of scenarios.entries()) {
      const jobId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const connection = createConnectionMock({
        execute: vi.fn(async (sql: string) => {
          if (sql.includes("FROM print_job WHERE id")) {
            return [
              [
                {
                  requestedBy: operator.id,
                  workstationId: 9,
                  status: "READY",
                  isExpired: scenario.expired,
                },
              ],
              [],
            ];
          }
          if (sql.includes("UPDATE print_job SET status")) return [{ affectedRows: 1 }, []];
          throw new Error(`Unexpected SQL in test: ${sql}`);
        }),
      });
      const audit = { record: vi.fn().mockResolvedValue(undefined) };

      await createService(connection, audit as unknown as MutationAuditRepository).complete(
        jobId,
        scenario.input,
        operator,
      );

      expect(audit.record).toHaveBeenCalledWith(connection, {
        eventType: scenario.eventType,
        actorUserId: operator.id,
        workstationId: 9,
        printJobId: jobId,
        details: scenario.details,
      });
      expect(audit.record.mock.invocationCallOrder[0]).toBeLessThan(connection.commit.mock.invocationCallOrder[0]);
    }
  });

  it("rejects a legacy READY job without a workstation before changing status or auditing", async () => {
    const connection = createConnectionMock({
      execute: vi.fn(async (sql: string) => {
        if (sql.includes("FROM print_job WHERE id")) {
          return [[{ requestedBy: operator.id, workstationId: null, status: "READY", isExpired: 0 }], []];
        }
        throw new Error(`Unexpected SQL in test: ${sql}`);
      }),
    });
    const audit = { record: vi.fn().mockResolvedValue(undefined) };

    await expect(
      createService(connection, audit as unknown as MutationAuditRepository).complete(
        "00000000-0000-4000-8000-000000000099",
        { status: "SENT" },
        operator,
      ),
    ).rejects.toThrow("출력 작업에 연결된 워크스테이션 정보가 없습니다.");
    expect(audit.record).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});

describe("PrintJobsService repository orchestration", () => {
  it("keeps repository writes, audit and commit in the established create order", async () => {
    const events: string[] = [];
    const connection = createConnectionMock({
      beginTransaction: vi.fn(async () => {
        events.push("begin");
      }),
      commit: vi.fn(async () => {
        events.push("commit");
      }),
      release: vi.fn(() => {
        events.push("release");
      }),
      execute: vi.fn(async () => {
        throw new Error("PrintJobsService must not execute SQL directly.");
      }),
      query: vi.fn(async () => {
        throw new Error("PrintJobsService must not query SQL directly.");
      }),
    });
    const repository = {
      findAssignedExamName: vi.fn(async () => {
        events.push("exam");
        return input.examName;
      }),
      findPrintPolicyForUpdate: vi.fn(async () => {
        events.push("policy");
        return enabledPrintPolicy;
      }),
      findByIdempotencyKey: vi.fn(async () => {
        events.push("idempotency");
        return null;
      }),
      findCandidateForUpdate: vi.fn(async () => {
        events.push("candidate");
        return {
          candidateRecordId: 202,
          examineeNo: input.examineeNo,
          examDate: input.examDate,
          roomName: "202호",
          seatNo: "22",
          labelBarcode: "EX10001",
          pseudonymNumber: "8201",
        };
      }),
      findActiveLabelTemplate: vi.fn(async () => {
        events.push("template");
        return { id: 5, version: 2, zplTemplate: "^XA^FD{{PSEUDONYM_NO}}^FS^XZ" };
      }),
      findEnabledWorkstationId: vi.fn(async () => {
        events.push("workstation");
        return 4;
      }),
      insertPrintJob: vi.fn(async () => {
        events.push("job");
      }),
      insertPayload: vi.fn(async () => {
        events.push("payload");
      }),
    } as unknown as PrintJobsRepository;
    const audit = {
      record: vi.fn(async () => {
        events.push("audit");
      }),
    };
    const identityProjection = {
      syncPrintSnapshot: vi.fn(async () => {
        events.push("snapshot");
      }),
    } as unknown as IdentityBackfillProjectionRepository;
    const identityTransition = targetWriteCoordinator(() => events.push("transition"));

    const result = await createService(
      connection,
      audit as unknown as MutationAuditRepository,
      repository,
      identityProjection,
      identityTransition,
    ).create(input, operator);

    expect(events).toEqual([
      "begin",
      "transition",
      "exam",
      "policy",
      "idempotency",
      "candidate",
      "template",
      "workstation",
      "job",
      "payload",
      "snapshot",
      "audit",
      "commit",
      "release",
    ]);
    expect(connection.execute).not.toHaveBeenCalled();
    expect(connection.query).not.toHaveBeenCalled();
    expect(repository.insertPrintJob).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({
        id: result.id,
        jobNo: result.jobNo,
        businessReference: input.examineeNo,
        templateId: 5,
        templateVersion: 2,
        workstationId: 4,
        requestedBy: operator.id,
        idempotencyKey,
        copies: input.copies,
        expirySeconds: 300,
      }),
    );
    expect(repository.insertPayload).toHaveBeenCalledWith(connection, result.id, result.payload);
    expect(identityProjection.syncPrintSnapshot).toHaveBeenCalledWith(connection, result.id, 202);
    expect(audit.record).toHaveBeenCalledWith(connection, {
      eventType: "PRINT_JOB_CREATED",
      actorUserId: operator.id,
      workstationId: 4,
      printJobId: result.id,
      details: { jobNo: result.jobNo, copies: input.copies },
    });
  });
});

describe("PrintJobsService retry and reprint history", () => {
  const sourcePrintJobId = "00000000-0000-4000-8000-000000000701";

  it("rejects target-only reissue before opening a connection when transition support is disabled", async () => {
    const getConnection = vi.fn();
    const service = new PrintJobsService(
      { getConnection } as unknown as Pool,
      resolveAppConfig({ IDENTITY_TRANSITION_ENABLED: "false" }),
    );

    await expect(
      service.reissue(
        sourcePrintJobId,
        {
          idempotencyKey: "00000000-0000-4000-8000-000000000700",
          reasonCode: "CLIENT_SEND_RETRY",
        },
        operator,
      ),
    ).rejects.toThrow("대상 신원 전환이 활성화된 환경");
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("fails closed before reading target print data when target writes are not enabled", async () => {
    const connection = createConnectionMock({});
    const repository = { findReissueSourceForUpdate: vi.fn() } as unknown as PrintJobsRepository;

    await expect(
      createService(connection, undefined, repository, undefined, legacyWriteCoordinator(), true).reissue(
        sourcePrintJobId,
        {
          idempotencyKey: "00000000-0000-4000-8000-000000000706",
          reasonCode: "CLIENT_SEND_RETRY",
        },
        operator,
      ),
    ).rejects.toThrow("대상 신원 쓰기가 활성화된 상태");
    expect(repository.findReissueSourceForUpdate).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it("creates a new immutable-snapshot job and appends retry history in one transaction", async () => {
    const events: string[] = [];
    const connection = createConnectionMock({
      beginTransaction: vi.fn(async () => {
        events.push("begin");
      }),
      commit: vi.fn(async () => {
        events.push("commit");
      }),
      release: vi.fn(() => {
        events.push("release");
      }),
    });
    let created:
      | {
          requestFingerprint: string;
          response: { id: string; jobNo: string; status: "READY"; copies: number; format: string; payload: string };
        }
      | undefined;
    let idempotencyLookups = 0;
    const repository = {
      findReissueSourceForUpdate: vi.fn(async () => {
        events.push("source");
        return { requestedBy: operator.id, workstationId: 4, status: "FAILED", isExpired: 0, hasSnapshot: 1 };
      }),
      findReissueContextForUpdate: vi.fn(async () => {
        events.push("context");
        return {
          actorRole: "OPERATOR",
          actorAdmissionScopeMode: "ASSIGNED",
          examCycleId: 31,
          admissionId: 32,
          admissionName: input.admissionName,
          workstationEnabled: 1,
        };
      }),
      hasAdmissionScopeForUpdate: vi.fn(async () => {
        events.push("scope");
        return true;
      }),
      listLegacyAdmissionNamesForUpdate: vi.fn(async () => {
        events.push("legacy-scope");
        return [input.admissionName];
      }),
      findEffectivePrintPolicyForUpdate: vi.fn(async () => {
        events.push("policy");
        return enabledPrintPolicy;
      }),
      findByIdempotencyKey: vi.fn(async () => {
        events.push(idempotencyLookups++ === 0 ? "idempotency" : "created");
        return created ?? null;
      }),
      insertReissuedPrintJob: vi.fn(async (_executor, record) => {
        events.push("job");
        created = {
          requestFingerprint: record.requestFingerprint,
          response: {
            id: record.id,
            jobNo: record.jobNo,
            status: "READY",
            copies: 1,
            format: "ZPL",
            payload: "^XA^XZ",
          },
        };
      }),
      insertPayloadFromSnapshot: vi.fn(async () => {
        events.push("payload");
      }),
      insertReissueEvent: vi.fn(async () => {
        events.push("history");
      }),
    } as unknown as PrintJobsRepository;
    const identityProjection = {
      syncPrintSnapshot: vi.fn(async () => {
        events.push("snapshot");
      }),
    } as unknown as IdentityBackfillProjectionRepository;
    const identityTransition = targetWriteCoordinator(() => events.push("transition"));
    const audit = {
      record: vi.fn(async () => {
        events.push("audit");
      }),
    };
    const request = {
      idempotencyKey: "00000000-0000-4000-8000-000000000702",
      reasonCode: "CLIENT_SEND_RETRY" as const,
    };

    const result = await createService(
      connection,
      audit as unknown as MutationAuditRepository,
      repository,
      identityProjection,
      identityTransition,
    ).reissue(sourcePrintJobId, request, operator);

    expect(events).toEqual([
      "begin",
      "transition",
      "source",
      "context",
      "scope",
      "legacy-scope",
      "policy",
      "idempotency",
      "job",
      "payload",
      "snapshot",
      "history",
      "audit",
      "created",
      "commit",
      "release",
    ]);
    expect(repository.insertReissuedPrintJob).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({
        id: result.id,
        sourcePrintJobId,
        requestedBy: operator.id,
        idempotencyKey: request.idempotencyKey,
        requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        reissueType: "RETRY",
        reasonCode: request.reasonCode,
      }),
    );
    expect(repository.findReissueContextForUpdate).toHaveBeenCalledWith(connection, sourcePrintJobId, operator.id);
    expect(repository.hasAdmissionScopeForUpdate).toHaveBeenCalledWith(connection, operator.id, 32);
    expect(repository.listLegacyAdmissionNamesForUpdate).toHaveBeenCalledWith(connection, operator.id);
    expect(repository.findEffectivePrintPolicyForUpdate).toHaveBeenCalledWith(connection, 31, 32);
    expect(repository.insertPayloadFromSnapshot).toHaveBeenCalledWith(connection, result.id, sourcePrintJobId);
    expect(identityProjection.syncPrintSnapshot).toHaveBeenCalledWith(connection, result.id);
    expect(repository.insertReissueEvent).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({ id: result.id, sourcePrintJobId, reissueType: "RETRY" }),
    );
    expect(audit.record).toHaveBeenCalledWith(connection, {
      eventType: "PRINT_JOB_REISSUED",
      actorUserId: operator.id,
      workstationId: 4,
      printJobId: result.id,
      details: { reissueType: "RETRY", reasonCode: request.reasonCode },
    });
  });

  it.each([
    {
      name: "non-terminal job",
      ownerId: operator.id,
      status: "READY" as const,
      reasonCode: "CLIENT_SEND_RETRY" as const,
      message: "실패·만료·전송 완료 상태",
    },
    {
      name: "retry reason for a sent job",
      ownerId: operator.id,
      status: "SENT" as const,
      reasonCode: "CLIENT_SEND_RETRY" as const,
      message: "상태와 재발행 사유 코드",
    },
    {
      name: "reprint reason for a failed job",
      ownerId: operator.id,
      status: "FAILED" as const,
      reasonCode: "LABEL_DAMAGED" as const,
      message: "상태와 재발행 사유 코드",
    },
    {
      name: "different operator's job",
      ownerId: operator.id + 1,
      status: "FAILED" as const,
      reasonCode: "CLIENT_SEND_RETRY" as const,
      message: "이 출력 작업을 변경할 수 없습니다.",
    },
  ])("rejects $name before creating history", async ({ ownerId, status, reasonCode, message }) => {
    const connection = createConnectionMock({});
    const repository = {
      findReissueSourceForUpdate: vi
        .fn()
        .mockResolvedValue({ requestedBy: ownerId, workstationId: 4, status, isExpired: 0, hasSnapshot: 1 }),
      findReissueContextForUpdate: vi.fn().mockResolvedValue({
        actorRole: "OPERATOR",
        actorAdmissionScopeMode: "ASSIGNED",
        examCycleId: 31,
        admissionId: 32,
        admissionName: input.admissionName,
        workstationEnabled: 1,
      }),
      hasAdmissionScopeForUpdate: vi.fn().mockResolvedValue(true),
      listLegacyAdmissionNamesForUpdate: vi.fn().mockResolvedValue([input.admissionName]),
      findEffectivePrintPolicyForUpdate: vi.fn().mockResolvedValue(enabledPrintPolicy),
      findByIdempotencyKey: vi.fn(),
      insertReissuedPrintJob: vi.fn(),
      insertPayloadFromSnapshot: vi.fn(),
      insertReissueEvent: vi.fn(),
    } as unknown as PrintJobsRepository;

    await expect(
      createService(connection, undefined, repository).reissue(
        sourcePrintJobId,
        { idempotencyKey: "00000000-0000-4000-8000-000000000703", reasonCode },
        operator,
      ),
    ).rejects.toThrow(message);
    expect(repository.findByIdempotencyKey).not.toHaveBeenCalled();
    expect(repository.insertReissuedPrintJob).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it("rejects a legacy source that has no immutable print snapshot", async () => {
    const connection = createConnectionMock({});
    const repository = {
      findReissueSourceForUpdate: vi.fn().mockResolvedValue({
        requestedBy: operator.id,
        workstationId: 4,
        status: "FAILED",
        isExpired: 0,
        hasSnapshot: 0,
      }),
      findByIdempotencyKey: vi.fn(),
      insertReissuedPrintJob: vi.fn(),
    } as unknown as PrintJobsRepository;

    await expect(
      createService(connection, undefined, repository).reissue(
        sourcePrintJobId,
        {
          idempotencyKey: "00000000-0000-4000-8000-000000000704",
          reasonCode: "CLIENT_SEND_RETRY",
        },
        operator,
      ),
    ).rejects.toThrow("불변 출력 snapshot이 없는 레거시 작업");
    expect(repository.findByIdempotencyKey).not.toHaveBeenCalled();
    expect(repository.insertReissuedPrintJob).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "missing target bridge or current assignment",
      context: null,
      hasScope: true,
      legacyAdmissions: [input.admissionName],
      policy: enabledPrintPolicy,
      message: "현재 활성 대상·가번호 연결",
    },
    {
      name: "disabled workstation",
      context: {
        actorRole: "OPERATOR" as const,
        actorAdmissionScopeMode: "ASSIGNED" as const,
        examCycleId: 31,
        admissionId: 32,
        admissionName: input.admissionName,
        workstationEnabled: 0,
      },
      hasScope: true,
      legacyAdmissions: [input.admissionName],
      policy: enabledPrintPolicy,
      message: "비활성화된 워크스테이션",
    },
    {
      name: "revoked admission scope",
      context: {
        actorRole: "OPERATOR" as const,
        actorAdmissionScopeMode: "ASSIGNED" as const,
        examCycleId: 31,
        admissionId: 32,
        admissionName: input.admissionName,
        workstationEnabled: 1,
      },
      hasScope: false,
      legacyAdmissions: [input.admissionName],
      policy: enabledPrintPolicy,
      message: "현재 배정되지 않은 전형",
    },
    {
      name: "revoked legacy admission scope during dual transition",
      context: {
        actorRole: "OPERATOR" as const,
        actorAdmissionScopeMode: "ASSIGNED" as const,
        examCycleId: 31,
        admissionId: 32,
        admissionName: input.admissionName,
        workstationEnabled: 1,
      },
      hasScope: true,
      legacyAdmissions: ["다른 전형"],
      policy: enabledPrintPolicy,
      message: "현재 배정되지 않은 전형",
    },
    {
      name: "disabled effective print policy",
      context: {
        actorRole: "OPERATOR" as const,
        actorAdmissionScopeMode: "ASSIGNED" as const,
        examCycleId: 31,
        admissionId: 32,
        admissionName: input.admissionName,
        workstationEnabled: 1,
      },
      hasScope: true,
      legacyAdmissions: [input.admissionName],
      policy: { assignmentMethod: "PREASSIGNED", printPreassignedLabel: 0 },
      message: "현재 사전부여 라벨 출력 정책",
    },
  ])("fails closed for $name", async ({ context, hasScope, legacyAdmissions, policy, message }) => {
    const connection = createConnectionMock({});
    const repository = {
      findReissueSourceForUpdate: vi.fn().mockResolvedValue({
        requestedBy: operator.id,
        workstationId: 4,
        status: "FAILED",
        isExpired: 0,
        hasSnapshot: 1,
      }),
      findReissueContextForUpdate: vi.fn().mockResolvedValue(context),
      hasAdmissionScopeForUpdate: vi.fn().mockResolvedValue(hasScope),
      listLegacyAdmissionNamesForUpdate: vi.fn().mockResolvedValue(legacyAdmissions),
      findEffectivePrintPolicyForUpdate: vi.fn().mockResolvedValue(policy),
      findByIdempotencyKey: vi.fn(),
      insertReissuedPrintJob: vi.fn(),
    } as unknown as PrintJobsRepository;

    await expect(
      createService(connection, undefined, repository).reissue(
        sourcePrintJobId,
        {
          idempotencyKey: "00000000-0000-4000-8000-000000000705",
          reasonCode: "CLIENT_SEND_RETRY",
        },
        operator,
      ),
    ).rejects.toThrow(message);
    expect(repository.findByIdempotencyKey).not.toHaveBeenCalled();
    expect(repository.insertReissuedPrintJob).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});

describe("PrintJobsService immutable target projection", () => {
  it("does not infer a bridge without an explicit source candidate id", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]);
    const projection = new IdentityBackfillProjectionRepository();
    const executor = { execute } as never;
    const printJobId = "00000000-0000-4000-8000-000000000901";

    await projection.syncPrintSnapshot(executor, printJobId);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toContain("INSERT IGNORE INTO print_projection_snapshot");
    expect(execute.mock.calls[0]?.[0]).not.toContain("candidate_registration");
    expect(execute.mock.calls[0]?.[0]).not.toContain("business_ref =");
    expect(execute.mock.calls[0]?.[0]).not.toContain("ON DUPLICATE KEY UPDATE");
    expect(execute.mock.calls[0]?.[0]).not.toContain("projection_json = VALUES");
    expect(execute.mock.calls[0]?.[1]).toEqual([printJobId]);
  });

  it("bridges only the explicit source id and refuses to overwrite a different target identity", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]);
    const projection = new IdentityBackfillProjectionRepository();
    const executor = { execute } as never;
    const printJobId = "00000000-0000-4000-8000-000000000902";

    await projection.syncPrintSnapshot(executor, printJobId, 202);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]?.[0]).toContain("registration.source_candidate_record_id = ?");
    expect(execute.mock.calls[0]?.[0]).toContain("job.candidate_registration_id IS NULL");
    expect(execute.mock.calls[0]?.[0]).toContain("job.operation_slot_id = slot.id");
    expect(execute.mock.calls[0]?.[0]).toContain("job.canonical_assignment_id = canonical_assignment.id");
    expect(execute.mock.calls[0]?.[1]).toEqual([202, printJobId]);
    expect(execute.mock.calls[1]?.[0]).toContain("INSERT IGNORE INTO print_projection_snapshot");
    expect(execute.mock.calls[1]?.[0]).not.toContain("ON DUPLICATE KEY UPDATE");
    expect(execute.mock.calls[1]?.[0]).not.toContain("projection_digest = VALUES");
  });
});

describe("PrintJobsService label-print policy enforcement", () => {
  it.each([
    ["DRAW", 1],
    ["PREASSIGNED", 0],
  ])("rejects assignment method %s with print flag %s before reading a print job", async (assignmentMethod, flag) => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT pa.exam_name AS examName")) return [[assignedExamName], []];
      if (sql.includes("FROM pseudonym_setting")) {
        return [[{ assignmentMethod, printPreassignedLabel: flag }], []];
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    });
    const connection = createConnectionMock({ execute });

    await expect(createService(connection).create(input, operator)).rejects.toThrow(
      "사전부여 방식에서 라벨 출력 사용이 설정된 전형만 라벨을 출력할 수 있습니다.",
    );
    expect(execute).not.toHaveBeenCalledWith(expect.stringContaining("FROM print_job pj"), expect.anything());
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it("derives the policy scope from the assigned candidate schedule instead of a client-supplied exam name", async () => {
    const storedJob = printJobRow(createPrintJobRequestFingerprint(input));
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT pa.exam_name AS examName")) return [[assignedExamName], []];
      if (sql.includes("FROM pseudonym_setting")) return [[enabledPrintPolicy], []];
      if (sql.includes("FROM print_job pj")) return [[storedJob], []];
      throw new Error(`Unexpected SQL in test: ${sql}`);
    });
    const connection = createConnectionMock({ execute });

    await expect(
      createService(connection).create({ ...input, examName: "위조된 다른 시험" }, operator),
    ).resolves.toEqual(printJobResponse(storedJob));
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("SELECT pa.exam_name AS examName"), [
      input.examineeNo,
      input.examDate,
      input.examTime,
      input.periodName,
      input.admissionName,
    ]);
  });
});

describe("print-job expiry configuration", () => {
  it("uses the documented 300 second default when the setting is absent", () => {
    expect(resolvePrintJobExpirySeconds(undefined)).toBe(300);
  });

  it("accepts a positive integer", () => {
    expect(resolvePrintJobExpirySeconds("45")).toBe(45);
  });

  it.each(["0", "-1", "1.5", "not-a-number", ""])("rejects invalid value %j", (value) => {
    expect(() => resolvePrintJobExpirySeconds(value)).toThrow("PRINT_JOB_EXPIRY_SECONDS must be a positive integer.");
  });
});

function createService(
  connection: ReturnType<typeof createConnectionMock>,
  audit?: MutationAuditRepository,
  repository?: PrintJobsRepository,
  identityProjection: IdentityBackfillProjectionRepository = {
    syncPrintSnapshot: vi.fn().mockResolvedValue(undefined),
  } as unknown as IdentityBackfillProjectionRepository,
  identityTransition: IdentityTransitionCoordinator = targetWriteCoordinator(),
  identityTransitionEnabled = true,
) {
  return new PrintJobsService(
    { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool,
    resolveAppConfig({
      PRINT_JOB_EXPIRY_SECONDS: "300",
      IDENTITY_TRANSITION_ENABLED: String(identityTransitionEnabled),
    }),
    audit,
    repository,
    identityProjection,
    identityTransition,
  );
}

function targetWriteCoordinator(onDecide?: () => void): IdentityTransitionCoordinator {
  const decision: IdentityWriteDecision = {
    state: {
      enabled: true,
      writeMode: "DUAL",
      readMode: "LEGACY",
      phase: "EXPANDED",
      version: 1,
      shadowHmacSecret: null,
    },
    writeLegacy: true,
    writeTarget: true,
    authority: "LEGACY",
  };
  return {
    decideWrite: vi.fn(async () => {
      onDecide?.();
      return decision;
    }),
  } as unknown as IdentityTransitionCoordinator;
}

function legacyWriteCoordinator(onDecide?: () => void): IdentityTransitionCoordinator {
  const decision: IdentityWriteDecision = {
    state: {
      enabled: false,
      writeMode: "LEGACY",
      readMode: "LEGACY",
      phase: "EXPANDED",
      version: 0,
      shadowHmacSecret: null,
    },
    writeLegacy: true,
    writeTarget: false,
    authority: "LEGACY",
  };
  return {
    decideWrite: vi.fn(async () => {
      onDecide?.();
      return decision;
    }),
  } as unknown as IdentityTransitionCoordinator;
}

function canonicalWriteCoordinator(): IdentityTransitionCoordinator {
  const decision: IdentityWriteDecision = {
    state: {
      enabled: true,
      writeMode: "CANONICAL",
      readMode: "CANONICAL",
      phase: "CANONICAL",
      version: 2,
      shadowHmacSecret: null,
    },
    writeLegacy: false,
    writeTarget: true,
    authority: "TARGET",
  };
  return { decideWrite: vi.fn().mockResolvedValue(decision) } as unknown as IdentityTransitionCoordinator;
}

function createConnectionMock(overrides: Record<string, unknown>) {
  return {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    execute: vi.fn(),
    query: vi.fn(),
    ...overrides,
  };
}

function printJobRow(requestFingerprint: string | null) {
  return {
    id: "a52be8c6-cf2a-47a0-aae2-12c0c7821974",
    jobNo: "PJ-TEST-001",
    status: "READY",
    copies: 1,
    format: "ZPL",
    payload: "^XA^XZ",
    requestFingerprint,
  } as const;
}

function printJobResponse(row: ReturnType<typeof printJobRow>) {
  const { requestFingerprint: _requestFingerprint, ...response } = row;
  return response;
}
