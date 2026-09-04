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
      .mockResolvedValueOnce([[{ assignmentMethod: "PREASSIGNED", printPreassignedLabel: 1, labelTemplateId: 7 }], []])
      .mockResolvedValueOnce([[candidate], []]);
    const repository = new PrintJobsRepository();
    const executor = asExecutor(execute);

    await expect(repository.findAssignedExamName(executor, schedule, "2026 시험")).resolves.toBe("2026 시험");
    await expect(repository.findPrintPolicyForUpdate(executor, "2026 시험", schedule.admissionName)).resolves.toEqual({
      assignmentMethod: "PREASSIGNED",
      printPreassignedLabel: 1,
      labelTemplateId: 7,
    });
    await expect(repository.findCandidateForUpdate(executor, schedule)).resolves.toEqual(candidate);

    expect(execute.mock.calls[0]?.[0]).toContain("COALESCE(pa.exam_name, ?) AS examName");
    expect(execute.mock.calls[1]?.[0]).toContain("label_template_id AS labelTemplateId");
    expect(execute.mock.calls[1]?.[0]).toContain("FOR UPDATE");
    expect(execute.mock.calls[2]?.[0]).toContain("cr.id AS candidateRecordId");
    expect(execute.mock.calls[2]?.[0]).toContain("FOR UPDATE");
  });

  it("selects the active label template assigned to the admission", async () => {
    const row = { id: 7, zplTemplate: "^XA^XZ", layout: '{"elements":[]}' };
    const execute = vi.fn().mockResolvedValue([[row], []]);
    const repository = new PrintJobsRepository();

    await expect(repository.findActiveLabelTemplate(asExecutor(execute), 7)).resolves.toEqual(row);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("FROM label_template"), [7, 7]);
    expect(execute.mock.calls[0]?.[0]).not.toContain("version");
  });

  it("persists a job without obsolete template version metadata", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 } as ResultSetHeader, []]);
    const repository = new PrintJobsRepository();
    const record = {
      id: "00000000-0000-4000-8000-000000000001",
      jobNo: "PJ-1",
      businessReference: "10001",
      candidateRecordId: 12,
      templateId: 7,
      workstationId: 4,
      requestedBy: 9,
      idempotencyKey: "request-key",
      requestFingerprint: "fingerprint",
      copies: 2,
      expirySeconds: 300,
    };

    await repository.insertPrintJob(asExecutor(execute), record);

    expect(execute.mock.calls[0]?.[0]).toContain("INSERT INTO print_job");
    expect(execute.mock.calls[0]?.[0]).not.toContain("template_version");
    expect(execute.mock.calls[0]?.[1]).toEqual([
      record.id,
      record.jobNo,
      record.businessReference,
      record.candidateRecordId,
      record.templateId,
      record.workstationId,
      record.requestedBy,
      record.idempotencyKey,
      record.requestFingerprint,
      record.copies,
      record.expirySeconds,
    ]);
  });

  it("locks the job owner and retains guarded terminal-status updates", async () => {
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

    for (const call of execute.mock.calls.slice(1)) expect(call[0]).toContain("status = 'READY'");
  });
});

function asExecutor(execute: ReturnType<typeof vi.fn>): SqlExecutor {
  return { execute, query: vi.fn() } as unknown as SqlExecutor;
}
