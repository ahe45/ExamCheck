import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import type { SaveFormTemplateDto, UpdateFormTemplateMetadataDto } from "./form-templates.dto.js";
import { FormTemplatesService } from "./form-templates.service.js";

const developer: AuthenticatedUser = {
  id: 3,
  loginId: "dev",
  role: "DEVELOPER",
  admissionNames: [],
};

describe("form-template security enforcement", () => {
  it("rejects a risky layout before opening a write transaction", async () => {
    const privateMarker = "홍길동-PRIVATE-MARKER";
    const input: SaveFormTemplateDto = {
      code: "security_test",
      name: "보안 검사",
      category: "테스트",
      usageScope: "CANDIDATE",
      active: true,
      layout: {
        pages: [{ settings: { documentHtml: `<script>${privateMarker}</script><img onload="alert(1)">` } }],
      },
    };
    const execute = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes("SELECT MAX(version)")) return [[{ version: 1 }], []];
      return [{ affectedRows: 1 }, []];
    });
    const connection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      execute,
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };
    const pool = {
      getConnection: vi.fn().mockResolvedValue(connection),
      execute: vi.fn().mockResolvedValue([
        [
          {
            id: 7,
            code: "SECURITY_TEST",
            version: 2,
            name: "보안 검사",
            description: null,
            category: "테스트",
            usageScope: "CANDIDATE",
            layout: JSON.stringify(input.layout),
            active: 1,
            createdAt: new Date("2026-08-28T00:00:00.000Z"),
            createdByLoginId: "dev",
          },
        ],
        [],
      ]),
    };
    const service = new FormTemplatesService(pool as unknown as Pool);

    await expect(service.save(input, developer)).rejects.toThrow("위험 요소 2개를 제거");
    expect(pool.getConnection).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it("stores riskCount zero and omits the risk event for a safe layout", async () => {
    const input: SaveFormTemplateDto = {
      code: "SAFE_TEST",
      name: "정상 양식",
      category: "테스트",
      usageScope: "CANDIDATE",
      layout: { pages: [{ settings: { documentHtml: "<p>정상 양식</p>" } }] },
    };
    const execute = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes("SELECT MAX(version)")) return [[{ version: null }], []];
      return [{ affectedRows: 1 }, []];
    });
    const connection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      execute,
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };
    const pool = {
      getConnection: vi.fn().mockResolvedValue(connection),
      execute: vi.fn().mockResolvedValue([
        [
          {
            id: 8,
            code: "SAFE_TEST",
            version: 1,
            name: "정상 양식",
            description: null,
            category: "테스트",
            usageScope: "CANDIDATE",
            layout: JSON.stringify(input.layout),
            active: 1,
            createdAt: new Date("2026-08-28T00:00:00.000Z"),
            createdByLoginId: "dev",
          },
        ],
        [],
      ]),
    };

    await new FormTemplatesService(pool as unknown as Pool).save(input, developer);

    expect(
      execute.mock.calls.some(([, parameters]) => parameters?.[0] === "FORM_TEMPLATE_SECURITY_RISK_DETECTED"),
    ).toBe(false);
    const saveAuditCall = execute.mock.calls.find(([, parameters]) => parameters?.[0] === "FORM_TEMPLATE_SAVED");
    expect(JSON.parse(String(saveAuditCall?.[1]?.[5]))).toEqual({
      code: "SAFE_TEST",
      version: 1,
      active: true,
      riskCount: 0,
    });
  });
});

describe("form-template version and activation behavior", () => {
  it("lists the latest version per code without applying the active filter", async () => {
    const rows = [templateRow({ code: "ROOM_LIST", version: 3, active: 0, layout: '{"pages":[]}' })];
    const execute = vi.fn().mockResolvedValue([rows, []]);
    const service = new FormTemplatesService({ execute } as unknown as Pool);

    await expect(service.listLatest(false)).resolves.toEqual([
      expect.objectContaining({ code: "ROOM_LIST", version: 3, active: false, layout: { pages: [] } }),
    ]);

    const sql = String(execute.mock.calls[0]?.[0]);
    expect(sql).toContain("SELECT code, MAX(version) AS version FROM form_template GROUP BY code");
    expect(sql).not.toContain("WHERE ft.active = TRUE");
    expect(sql).toContain("ORDER BY ft.category, ft.name");
  });

  it("filters active templates only after selecting each code's latest version", async () => {
    const rows = [templateRow({ code: "ACTIVE_FORM", version: 4, active: 1 })];
    const execute = vi.fn().mockResolvedValue([rows, []]);
    const service = new FormTemplatesService({ execute } as unknown as Pool);

    await expect(service.listLatest(true)).resolves.toEqual([
      expect.objectContaining({ code: "ACTIVE_FORM", version: 4, active: true }),
    ]);

    const sql = String(execute.mock.calls[0]?.[0]);
    const latestJoinIndex = sql.indexOf("latest ON latest.code");
    const activeFilterIndex = sql.indexOf("WHERE ft.active = TRUE");
    expect(latestJoinIndex).toBeGreaterThan(-1);
    expect(activeFilterIndex).toBeGreaterThan(latestJoinIndex);
  });

  it("deactivates the previous active version before inserting and returning a new active version", async () => {
    const input = safeTemplateInput({ code: " room_list ", active: true, description: " 최신 설명 " });
    const events: string[] = [];
    const connection = transactionConnection(events, async (sql) => {
      if (sql.includes("SELECT MAX(version)")) return [[{ version: 2 }], []];
      return [{ affectedRows: 1 }, []];
    });
    const execute = vi.fn(async (sql: string) => {
      events.push(sql.includes("WHERE ft.code") ? "read-active" : "read-latest");
      return [[templateRow({ code: "ROOM_LIST", version: 3, name: input.name, active: 1 })], []];
    });
    const service = new FormTemplatesService({
      getConnection: vi.fn().mockResolvedValue(connection),
      execute,
    } as unknown as Pool);

    await expect(service.save(input, developer)).resolves.toEqual(
      expect.objectContaining({ code: "ROOM_LIST", version: 3, active: true }),
    );

    expect(connection.execute.mock.calls.map(([sql, parameters]) => sqlKind(String(sql), parameters))).toEqual([
      "select-version",
      "deactivate",
      "insert",
      "audit",
    ]);
    expect(connection.execute.mock.calls[1]?.[1]).toEqual(["ROOM_LIST"]);
    expect(connection.execute.mock.calls[2]?.[1]).toEqual([
      "ROOM_LIST",
      3,
      "양식 제목",
      "최신 설명",
      "운영",
      "CANDIDATE",
      JSON.stringify(input.layout),
      true,
      developer.id,
    ]);
    expect(connection.execute.mock.calls[3]?.[1]).toEqual([
      "FORM_TEMPLATE_SAVED",
      developer.id,
      null,
      null,
      null,
      JSON.stringify({ code: "ROOM_LIST", version: 3, active: true, riskCount: 0 }),
    ]);
    expect(events).toEqual([
      "begin",
      "select-version",
      "deactivate",
      "insert",
      "audit",
      "commit",
      "read-active",
      "release",
    ]);
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it("also deactivates the prior active version and returns the latest row when saving inactive", async () => {
    const input = safeTemplateInput({ code: "room_list", active: false });
    const events: string[] = [];
    const connection = transactionConnection(events, async (sql) => {
      if (sql.includes("SELECT MAX(version)")) return [[{ version: 2 }], []];
      return [{ affectedRows: 1 }, []];
    });
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("WHERE ft.code")) {
        events.push("read-active");
        return [[], []];
      }
      events.push("read-latest");
      return [[templateRow({ code: "ROOM_LIST", version: 3, active: 0 })], []];
    });
    const service = new FormTemplatesService({
      getConnection: vi.fn().mockResolvedValue(connection),
      execute,
    } as unknown as Pool);

    await expect(service.save(input, developer)).resolves.toEqual(
      expect.objectContaining({ code: "ROOM_LIST", version: 3, active: false }),
    );

    expect(connection.execute.mock.calls.map(([sql, parameters]) => sqlKind(String(sql), parameters))).toEqual([
      "select-version",
      "deactivate",
      "insert",
      "audit",
    ]);
    expect(connection.execute.mock.calls[2]?.[1]?.at(-2)).toBe(false);
    expect(connection.execute.mock.calls[3]?.[1]).toEqual([
      "FORM_TEMPLATE_SAVED",
      developer.id,
      null,
      null,
      null,
      JSON.stringify({ code: "ROOM_LIST", version: 3, active: false, riskCount: 0 }),
    ]);
    expect(events).toEqual([
      "begin",
      "select-version",
      "deactivate",
      "insert",
      "audit",
      "commit",
      "read-active",
      "release",
      "read-latest",
    ]);
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it("updates metadata on the latest version under lock, audits, commits, then reloads the latest row", async () => {
    const input: UpdateFormTemplateMetadataDto = { name: " 최신 제목 ", description: " 새 설명 " };
    const events: string[] = [];
    const connection = transactionConnection(events, async (sql) => {
      if (sql.startsWith("SELECT id")) return [[{ id: 88 }], []];
      return [{ affectedRows: 1 }, []];
    });
    const execute = vi.fn(async () => {
      events.push("read-latest");
      return [[templateRow({ id: 88, code: "ROOM_LIST", version: 7, name: "최신 제목" })], []];
    });
    const service = new FormTemplatesService({
      getConnection: vi.fn().mockResolvedValue(connection),
      execute,
    } as unknown as Pool);

    await expect(service.updateMetadata(" room_list ", input, developer)).resolves.toEqual(
      expect.objectContaining({ id: 88, code: "ROOM_LIST", version: 7, name: "최신 제목" }),
    );

    expect(connection.execute.mock.calls.map(([sql, parameters]) => sqlKind(String(sql), parameters))).toEqual([
      "select-latest-id",
      "update-metadata",
      "audit-metadata",
    ]);
    expect(connection.execute.mock.calls[0]?.[0]).toContain("ORDER BY version DESC LIMIT 1 FOR UPDATE");
    expect(connection.execute.mock.calls[0]?.[1]).toEqual(["ROOM_LIST"]);
    expect(connection.execute.mock.calls[1]?.[1]).toEqual(["최신 제목", "새 설명", 88]);
    expect(connection.execute.mock.calls[2]?.[1]).toEqual([
      "FORM_TEMPLATE_METADATA_UPDATED",
      developer.id,
      null,
      null,
      null,
      JSON.stringify({ code: "ROOM_LIST", templateId: 88 }),
    ]);
    expect(events).toEqual([
      "begin",
      "select-latest-id",
      "update-metadata",
      "audit-metadata",
      "commit",
      "read-latest",
      "release",
    ]);
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it("rolls back without post-commit reads when a version write fails", async () => {
    const events: string[] = [];
    const connection = transactionConnection(events, async (sql) => {
      if (sql.includes("SELECT MAX(version)")) return [[{ version: 1 }], []];
      if (sql.includes("INSERT INTO form_template")) throw new Error("write failed");
      return [{ affectedRows: 1 }, []];
    });
    const execute = vi.fn();
    const service = new FormTemplatesService({
      getConnection: vi.fn().mockResolvedValue(connection),
      execute,
    } as unknown as Pool);

    await expect(service.save(safeTemplateInput(), developer)).rejects.toThrow("write failed");

    expect(events).toEqual(["begin", "select-version", "deactivate", "insert", "rollback", "release"]);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

function safeTemplateInput(overrides: Partial<SaveFormTemplateDto> = {}): SaveFormTemplateDto {
  return {
    code: "ROOM_LIST",
    name: "양식 제목",
    description: "양식 설명",
    category: "운영",
    usageScope: "CANDIDATE",
    active: true,
    layout: { pages: [{ id: "page-1" }] },
    ...overrides,
  };
}

function templateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 21,
    code: "ROOM_LIST",
    version: 1,
    name: "양식 제목",
    description: "양식 설명",
    category: "운영",
    usageScope: "CANDIDATE",
    layout: { pages: [] },
    active: 1,
    createdAt: new Date("2026-08-28T00:00:00.000Z"),
    createdByLoginId: "dev",
    ...overrides,
  };
}

function transactionConnection(
  events: string[],
  executeImplementation: (sql: string, parameters?: unknown[]) => Promise<unknown>,
) {
  return {
    beginTransaction: vi.fn(async () => {
      events.push("begin");
    }),
    execute: vi.fn(async (sql: string, parameters?: unknown[]) => {
      events.push(sqlKind(sql, parameters));
      return executeImplementation(sql, parameters);
    }),
    commit: vi.fn(async () => {
      events.push("commit");
    }),
    rollback: vi.fn(async () => {
      events.push("rollback");
    }),
    release: vi.fn(() => {
      events.push("release");
    }),
  };
}

function sqlKind(sql: string, parameters?: unknown[]) {
  if (sql.includes("SELECT MAX(version)")) return "select-version";
  if (sql.startsWith("UPDATE form_template SET active")) return "deactivate";
  if (sql.includes("INSERT INTO form_template")) return "insert";
  if (sql.includes("INSERT INTO audit_log") && parameters?.[0] === "FORM_TEMPLATE_SAVED") return "audit";
  if (sql.startsWith("SELECT id")) return "select-latest-id";
  if (sql.startsWith("UPDATE form_template SET name")) return "update-metadata";
  if (sql.includes("INSERT INTO audit_log") && parameters?.[0] === "FORM_TEMPLATE_METADATA_UPDATED")
    return "audit-metadata";
  return "unknown";
}
