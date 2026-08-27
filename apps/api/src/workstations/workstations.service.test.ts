import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { WorkstationsRepository } from "./workstations.repository.js";
import { WorkstationsService } from "./workstations.service.js";

const input = {
  code: "GT800-02",
  name: "운영 프린터",
  location: "면접실",
  description: "Zebra GT800",
};

describe("WorkstationsService mutation boundary", () => {
  it("commits the workstation and audit record in one transaction", async () => {
    const connection = createConnection();
    connection.execute.mockResolvedValueOnce([{ insertId: 17 }, []]).mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const service = createService(connection);

    await expect(service.create(input, 7)).resolves.toEqual({ id: 17, ...input, enabled: true });

    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.execute.mock.calls[0]?.[0]).toContain("INSERT INTO workstation");
    expect(connection.execute.mock.calls[1]?.[0]).toContain("INSERT INTO audit_log");
    expect(connection.execute.mock.calls[1]?.[1]).toEqual([
      "WORKSTATION_CREATED",
      7,
      17,
      null,
      null,
      JSON.stringify({ workstationId: 17, code: input.code }),
    ]);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it("rolls back the workstation insert when the audit record fails", async () => {
    const connection = createConnection();
    connection.execute
      .mockResolvedValueOnce([{ insertId: 17 }, []])
      .mockRejectedValueOnce(new Error("audit unavailable"));
    const service = createService(connection);

    await expect(service.create(input, 7)).rejects.toThrow("audit unavailable");
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it("maps a duplicate code to a stable conflict after rollback", async () => {
    const connection = createConnection();
    connection.execute.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" }));
    const service = createService(connection);

    await expect(service.create(input, 7)).rejects.toThrow("이미 등록된 워크스테이션 코드입니다.");
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });
});

function createService(connection: ReturnType<typeof createConnection>) {
  const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;
  return new WorkstationsService(pool, new WorkstationsRepository(pool), new MutationAuditRepository());
}

function createConnection() {
  return {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    execute: vi.fn(),
  };
}
