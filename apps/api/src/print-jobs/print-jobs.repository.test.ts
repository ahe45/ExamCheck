import type { ResultSetHeader } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { PrintJobsRepository, type PrintJobScheduleKey } from "./print-jobs.repository.js";

const schedule: PrintJobScheduleKey = {
  examineeNo: "10001",
  examDate: "2026-08-11",
  examTime: "09:00",
  periodName: "1교시",
  admissionName: "배정 전형",
};

describe("PrintJobsRepository", () => {
  it("keeps the assigned schedule lookup before the policy and candidate locks", async () => {
    const candidate = {
      candidateRecordId: 12,
      examineeNo: schedule.examineeNo,
      examDate: schedule.examDate,
      roomName: "202호",
      seatNo: "22",
      labelBarcode: "EX10001",
      pseudonymNumber: "8201",
    };
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[{ examName: "2026 시험" }], []])
      .mockResolvedValueOnce([[{ assignmentMethod: "PREASSIGNED", printPreassignedLabel: 1 }], []])
      .mockResolvedValueOnce([[candidate], []]);
    const repository = new PrintJobsRepository();
    const executor = asExecutor(execute);

    await expect(repository.findAssignedExamName(executor, schedule)).resolves.toBe("2026 시험");
    await expect(repository.findPrintPolicyForUpdate(executor, "2026 시험", schedule.admissionName)).resolves.toEqual({
      assignmentMethod: "PREASSIGNED",
      printPreassignedLabel: 1,
    });
    await expect(repository.findCandidateForUpdate(executor, schedule)).resolves.toEqual(candidate);

    expect(execute.mock.calls[0]?.[0]).toContain("SELECT pa.exam_name AS examName");
    expect(execute.mock.calls[0]?.[0]).not.toContain("FOR UPDATE");
    expect(execute.mock.calls[0]?.[1]).toEqual(Object.values(schedule));
    expect(execute.mock.calls[1]?.[0]).toContain("FROM pseudonym_setting");
    expect(execute.mock.calls[1]?.[0]).toContain("FOR UPDATE");
    expect(execute.mock.calls[1]?.[1]).toEqual(["2026 시험", schedule.admissionName, schedule.admissionName]);
    expect(execute.mock.calls[2]?.[0]).toContain("cr.id AS candidateRecordId");
    expect(execute.mock.calls[2]?.[0]).toContain("cr.room_name AS roomName");
    expect(execute.mock.calls[2]?.[0]).toContain("COALESCE(cr.designated_sort");
    expect(execute.mock.calls[2]?.[0]).toContain("FOR UPDATE");
    expect(execute.mock.calls[2]?.[1]).toEqual(Object.values(schedule));
  });

  it("maps the active template, workstation and idempotent response without changing the response contract", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[{ id: 4 }], []])
      .mockResolvedValueOnce([
        [
          {
            id: "00000000-0000-4000-8000-000000000001",
            jobNo: "PJ-1",
            status: "READY",
            copies: "2",
            format: "ZPL",
            payload: "^XA^XZ",
            requestFingerprint: "fingerprint",
          },
        ],
        [],
      ]);
    const query = vi.fn().mockResolvedValue([[{ id: 7, version: 3, zplTemplate: "^XA^FD{{PSEUDONYM_NO}}^FS^XZ" }], []]);
    const repository = new PrintJobsRepository();
    const executor = asExecutor(execute, query);

    await expect(repository.findActiveLabelTemplate(executor)).resolves.toEqual({
      id: 7,
      version: 3,
      zplTemplate: "^XA^FD{{PSEUDONYM_NO}}^FS^XZ",
    });
    await expect(repository.findEnabledWorkstationId(executor, "GT800-01")).resolves.toBe(4);
    await expect(repository.findByIdempotencyKey(executor, 9, "request-key")).resolves.toEqual({
      requestFingerprint: "fingerprint",
      response: {
        id: "00000000-0000-4000-8000-000000000001",
        jobNo: "PJ-1",
        status: "READY",
        copies: 2,
        format: "ZPL",
        payload: "^XA^XZ",
      },
    });

    expect(query.mock.calls[0]?.[0]).toContain("code = 'PSEUDONYM_LABEL'");
    expect(execute.mock.calls[0]).toEqual([expect.stringContaining("FROM workstation"), ["GT800-01"]]);
    expect(execute.mock.calls[1]).toEqual([expect.stringContaining("FROM print_job pj"), [9, "request-key"]]);
  });

  it("persists the job header and payload with the original column and parameter order", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 } as ResultSetHeader, []]);
    const repository = new PrintJobsRepository();
    const executor = asExecutor(execute);
    const record = {
      id: "00000000-0000-4000-8000-000000000001",
      jobNo: "PJ-1",
      businessReference: "10001",
      templateId: 7,
      templateVersion: 3,
      workstationId: 4,
      requestedBy: 9,
      idempotencyKey: "request-key",
      requestFingerprint: "fingerprint",
      copies: 2,
      expirySeconds: 300,
    };

    await repository.insertPrintJob(executor, record);
    await repository.insertPayload(executor, record.id, "^XA^XZ");

    expect(execute.mock.calls[0]?.[0]).toContain("INSERT INTO print_job");
    expect(execute.mock.calls[0]?.[0]).toContain("DATE_ADD(NOW(3), INTERVAL ? SECOND)");
    expect(execute.mock.calls[0]?.[1]).toEqual([
      record.id,
      record.jobNo,
      record.businessReference,
      record.templateId,
      record.templateVersion,
      record.workstationId,
      record.requestedBy,
      record.idempotencyKey,
      record.requestFingerprint,
      record.copies,
      record.expirySeconds,
    ]);
    expect(execute.mock.calls[1]).toEqual([
      expect.stringContaining("INSERT INTO print_job_payload"),
      [record.id, "^XA^XZ"],
    ]);
  });

  it("locks the job owner and retains each guarded terminal-status update", async () => {
    const owner = { requestedBy: 9, workstationId: 4, status: "READY", isExpired: 0 };
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[owner], []])
      .mockResolvedValue([{ affectedRows: 1 } as ResultSetHeader, []]);
    const repository = new PrintJobsRepository();
    const executor = asExecutor(execute);
    const id = "00000000-0000-4000-8000-000000000001";

    await expect(repository.findJobForUpdate(executor, id)).resolves.toEqual(owner);
    await repository.markExpired(executor, id);
    await repository.markSent(executor, id);
    await repository.markFailed(executor, id, "전송 실패");

    expect(execute.mock.calls[0]).toEqual([expect.stringContaining("LIMIT 1 FOR UPDATE"), [id]]);
    expect(execute.mock.calls[0]?.[0]).not.toContain("print_projection_snapshot");
    expect(execute.mock.calls[1]).toEqual([expect.stringContaining("status = 'EXPIRED'"), [id]]);
    expect(execute.mock.calls[2]).toEqual([expect.stringContaining("status = 'SENT'"), [id]]);
    expect(execute.mock.calls[3]).toEqual([expect.stringContaining("status = 'FAILED'"), ["전송 실패", id]]);
    for (const call of execute.mock.calls.slice(1)) {
      expect(call[0]).toContain("status = 'READY'");
    }
  });

  it("keeps target snapshot lookup isolated to the reissue-only source lock", async () => {
    const source = { requestedBy: 9, workstationId: 4, status: "FAILED", isExpired: 0, hasSnapshot: 1 };
    const execute = vi.fn().mockResolvedValue([[source], []]);
    const repository = new PrintJobsRepository();
    const executor = asExecutor(execute);
    const id = "00000000-0000-4000-8000-000000000001";

    await expect(repository.findReissueSourceForUpdate(executor, id)).resolves.toEqual(source);

    expect(execute.mock.calls[0]).toEqual([expect.stringContaining("LIMIT 1 FOR UPDATE"), [id]]);
    expect(execute.mock.calls[0]?.[0]).toContain("FROM print_projection_snapshot snapshot");
  });

  it("copies a reissued job and payload while appending one source-linked event", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 } as ResultSetHeader, []]);
    const repository = new PrintJobsRepository();
    const executor = asExecutor(execute);
    const record = {
      id: "00000000-0000-4000-8000-000000000002",
      jobNo: "PJ-RETRY-1",
      sourcePrintJobId: "00000000-0000-4000-8000-000000000001",
      requestedBy: 9,
      idempotencyKey: "00000000-0000-4000-8000-000000000003",
      requestFingerprint: "a".repeat(64),
      expirySeconds: 300,
      reissueType: "RETRY" as const,
      reasonCode: "CLIENT_SEND_RETRY",
    };

    await repository.insertReissuedPrintJob(executor, record);
    await repository.insertPayloadFromSnapshot(executor, record.id, record.sourcePrintJobId);
    await repository.insertReissueEvent(executor, record);

    expect(execute.mock.calls[0]?.[0]).toContain("COALESCE(source.original_job_id, source.id)");
    expect(execute.mock.calls[0]?.[0]).toContain("source.canonical_assignment_id");
    expect(execute.mock.calls[0]?.[1]).toEqual([
      record.id,
      record.jobNo,
      record.requestedBy,
      record.idempotencyKey,
      record.requestFingerprint,
      record.expirySeconds,
      record.reasonCode,
      record.sourcePrintJobId,
    ]);
    expect(execute.mock.calls[1]).toEqual([
      expect.stringContaining("JSON_EXTRACT(projection_json, '$.payload')"),
      [record.id, record.sourcePrintJobId],
    ]);
    expect(execute.mock.calls[2]).toEqual([
      expect.stringContaining("INSERT INTO print_job_reissue_event"),
      [record.sourcePrintJobId, record.id, record.reissueType, record.reasonCode, record.requestedBy],
    ]);
  });

  it("locks the active target graph, current account scope and admission-first effective policy", async () => {
    const context = {
      actorRole: "OPERATOR",
      actorAdmissionScopeMode: "ASSIGNED",
      examCycleId: 21,
      admissionId: 22,
      admissionName: "배정 전형",
      workstationEnabled: 1,
    };
    const execute = vi.fn(async (sql: string, _parameters?: unknown[]) => {
      if (sql.includes("FROM print_job job")) return [[context], []];
      if (sql.includes("FROM user_admission_scope_assignment")) return [[{ admissionId: 22 }], []];
      if (sql.includes("FROM user_admission_assignment")) return [[{ admissionName: "배정 전형" }], []];
      if (sql.includes("FROM pseudonym_policy policy")) {
        return [[{ assignmentMethod: "PREASSIGNED", printPreassignedLabel: 1 }], []];
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    });
    const repository = new PrintJobsRepository();
    const executor = asExecutor(execute);
    const printJobId = "00000000-0000-4000-8000-000000000001";

    await expect(repository.findReissueContextForUpdate(executor, printJobId, 9)).resolves.toEqual(context);
    await expect(repository.hasAdmissionScopeForUpdate(executor, 9, 22)).resolves.toBe(true);
    await expect(repository.listLegacyAdmissionNamesForUpdate(executor, 9)).resolves.toEqual(["배정 전형"]);
    await expect(repository.findEffectivePrintPolicyForUpdate(executor, 21, 22)).resolves.toEqual({
      assignmentMethod: "PREASSIGNED",
      printPreassignedLabel: 1,
    });

    const graphSql = String(execute.mock.calls[0]?.[0]);
    expect(graphSql).toContain("registration.status = 'ACTIVE'");
    expect(graphSql).toContain("candidate_identity.status = 'ACTIVE'");
    expect(graphSql).toContain("segment.status = 'ACTIVE'");
    expect(graphSql).toContain("slot.id = job.operation_slot_id AND slot.status = 'ACTIVE'");
    expect(graphSql).toContain("admission.status = 'ACTIVE'");
    expect(graphSql).toContain("admission.canonical_name AS admissionName");
    expect(graphSql).toContain("cycle.status = 'ACTIVE'");
    expect(graphSql).toContain("assignment.registration_id = registration.id");
    expect(graphSql).toContain("operation.operation_slot_id = slot.id");
    expect(graphSql).toContain("actor.enabled = TRUE");
    expect(execute.mock.calls[0]?.[1]).toEqual([9, printJobId]);
    expect(execute.mock.calls[1]).toEqual([expect.stringContaining("LIMIT 1 FOR UPDATE"), [9, 22]]);
    expect(execute.mock.calls[2]).toEqual([expect.stringContaining("ORDER BY admission_name FOR UPDATE"), [9]]);
    const policySql = String(execute.mock.calls[3]?.[0]);
    expect(policySql).toContain("policy.scope_kind = 'ADMISSION'");
    expect(policySql).toContain("policy.scope_kind = 'DEFAULT'");
    expect(policySql).toContain("NOT EXISTS");
    expect(policySql).toContain("admission_override.scope_kind = 'ADMISSION'");
    expect(execute.mock.calls[3]?.[1]).toEqual([21, 22, 22]);
  });
});

function asExecutor(execute: ReturnType<typeof vi.fn>, query: ReturnType<typeof vi.fn> = vi.fn()): SqlExecutor {
  return { execute, query } as unknown as SqlExecutor;
}
