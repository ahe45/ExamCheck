import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import type { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { resolveAppConfig } from "../config/app-config.js";
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
});

describe("PrintJobsService audit transaction executor", () => {
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

    const result = await createService(connection, audit as unknown as MutationAuditRepository, repository).create(
      input,
      operator,
    );

    expect(events).toEqual([
      "begin",
      "exam",
      "policy",
      "idempotency",
      "candidate",
      "template",
      "workstation",
      "job",
      "payload",
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
    expect(audit.record).toHaveBeenCalledWith(connection, {
      eventType: "PRINT_JOB_CREATED",
      actorUserId: operator.id,
      workstationId: 4,
      printJobId: result.id,
      details: { jobNo: result.jobNo, copies: input.copies },
    });
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
) {
  return new PrintJobsService(
    { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool,
    resolveAppConfig({ PRINT_JOB_EXPIRY_SECONDS: "300" }),
    audit,
    repository,
  );
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
