import { describe, expect, it, vi } from "vitest";
import {
  calculateMigrationChecksum,
  DEFAULT_MIGRATION_LOCK_TIMEOUT_SECONDS,
  decideMigrationAction,
  MIGRATION_ADVISORY_LOCK_NAME,
  runMigrations,
  type MigrationConnection,
  type MigrationFile,
} from "./migration-runner.js";

describe("migration runner", () => {
  it("calculates a deterministic SHA-256 checksum from exact file contents", () => {
    expect(calculateMigrationChecksum("SELECT 1;\n")).toBe(
      "b4e0497804e46e0a0b0b8c31975b062152d551bac49c3c2e80932567b4085dcd",
    );
    expect(calculateMigrationChecksum("SELECT 1;")).not.toBe(calculateMigrationChecksum("SELECT 1;\n"));
  });

  it("rejects edits to an already checksummed migration", () => {
    expect(() =>
      decideMigrationAction("001_initial.sql", { checksum: "recorded-checksum" }, "current-checksum"),
    ).toThrow("Migration checksum mismatch: 001_initial.sql");
  });

  it("expands the legacy table, backfills legacy rows, verifies matches, and applies new files", async () => {
    const calls: string[] = [];
    const migrations: MigrationFile[] = [
      { version: "001_initial.sql", sql: "SELECT 1;", checksum: "legacy-checksum" },
      { version: "002_existing.sql", sql: "SELECT 2;", checksum: "existing-checksum" },
      { version: "003_new.sql", sql: "SELECT 3;", checksum: "new-checksum" },
    ];
    const connection = {
      query: vi.fn(async (sql: string) => {
        calls.push(`query:${normalizedSql(sql)}`);
        return [[], []];
      }),
      execute: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push(`execute:${normalizedSql(sql)}:${params.join("/")}`);
        if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }], []];
        if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }], []];
        if (sql.startsWith("SELECT version")) {
          return [
            [
              { version: "001_initial.sql", checksum: null, status: "APPLIED" },
              { version: "002_existing.sql", checksum: "existing-checksum", status: "APPLIED" },
            ],
            [],
          ];
        }
        return [{ affectedRows: 1 }, []];
      }),
      beginTransaction: vi.fn(async () => {
        calls.push("begin");
      }),
      commit: vi.fn(async () => {
        calls.push("commit");
      }),
      rollback: vi.fn(async () => {
        calls.push("rollback");
      }),
    } as unknown as MigrationConnection;

    const result = await runMigrations(connection, migrations);

    expect(result).toEqual({
      applied: ["003_new.sql"],
      checksumBackfilled: ["001_initial.sql"],
      verified: ["002_existing.sql"],
    });
    expect(calls.some((call) => call.includes("ALTER TABLE schema_migration ADD COLUMN checksum"))).toBe(true);
    expect(calls.some((call) => call.includes("ALTER TABLE schema_migration ADD COLUMN status"))).toBe(true);
    expect(calls).toContain("query:SELECT 3;");
    expect(calls).toContain("begin");
    expect(calls).toContain("commit");
    expect(calls).not.toContain("rollback");
    expect(calls).toContain(
      `execute:SELECT GET_LOCK(?, ?) AS acquired:${MIGRATION_ADVISORY_LOCK_NAME}/${DEFAULT_MIGRATION_LOCK_TIMEOUT_SECONDS}`,
    );
    expect(calls).toContain(`execute:SELECT RELEASE_LOCK(?) AS released:${MIGRATION_ADVISORY_LOCK_NAME}`);
    expect(calls).toContain(
      "execute:INSERT INTO schema_migration(version, checksum, status) VALUES (?, ?, 'APPLYING'):003_new.sql/new-checksum",
    );
    expect(calls).toContain(
      "execute:UPDATE schema_migration SET status = 'APPLIED' WHERE version = ? AND status = 'APPLYING':003_new.sql",
    );
  });

  it("detects all checksum mismatches before backfilling or applying anything", async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }], []];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }], []];
      if (!sql.startsWith("SELECT version")) return [{ affectedRows: 1 }, []];
      return [
        [
          { version: "001_legacy.sql", checksum: null, status: "APPLIED" },
          { version: "002_changed.sql", checksum: "old", status: "APPLIED" },
        ],
        [],
      ];
    });
    const connection = {
      query: vi.fn(async (sql: string) => (sql.startsWith("SHOW COLUMNS") ? [[{ Field: "checksum" }], []] : [[], []])),
      execute,
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
    } as unknown as MigrationConnection;

    await expect(
      runMigrations(connection, [
        { version: "001_legacy.sql", sql: "SELECT 1;", checksum: "new-legacy" },
        { version: "002_changed.sql", sql: "SELECT 2;", checksum: "new" },
      ]),
    ).rejects.toThrow("Migration checksum mismatch: 002_changed.sql");

    expect(execute.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE schema_migration"))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => String(sql).startsWith("INSERT INTO schema_migration"))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes("RELEASE_LOCK"))).toBe(true);
    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });

  it("rolls back and records FAILED without persisting the failed SQL when migration SQL fails", async () => {
    const execute = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }], []];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }], []];
      return sql.startsWith("SELECT version") ? [[], []] : [{ affectedRows: 1 }, []];
    });
    const connection = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith("SHOW COLUMNS")) return [[{ Field: "checksum" }], []];
        if (sql === "BROKEN SQL") throw new Error("syntax error");
        return [[], []];
      }),
      execute,
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    } as unknown as MigrationConnection;

    await expect(
      runMigrations(connection, [{ version: "019_broken.sql", sql: "BROKEN SQL", checksum: "broken-checksum" }]),
    ).rejects.toThrow("Migration failed: 019_broken.sql");

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(execute.mock.calls.some(([sql]) => String(sql).startsWith("INSERT INTO schema_migration"))).toBe(true);
    expect(
      execute.mock.calls.some(
        ([sql, params]) =>
          String(sql).includes("SET status = 'FAILED'") && Array.isArray(params) && params[0] === "019_broken.sql",
      ),
    ).toBe(true);
    expect(JSON.stringify(execute.mock.calls)).not.toContain("BROKEN SQL");
    expect(execute.mock.calls.some(([sql]) => String(sql).includes("RELEASE_LOCK"))).toBe(true);
  });

  it.each(["APPLYING", "FAILED"] as const)("blocks all work when a migration is left %s", async (status) => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }], []];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }], []];
      if (sql.startsWith("SELECT version")) {
        return [[{ version: "019_dirty.sql", checksum: "dirty-checksum", status }], []];
      }
      return [{ affectedRows: 1 }, []];
    });
    const connection = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("'checksum'")) return [[{ Field: "checksum" }], []];
        if (sql.includes("'status'")) return [[{ Field: "status" }], []];
        return [[], []];
      }),
      execute,
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
    } as unknown as MigrationConnection;

    await expect(
      runMigrations(connection, [{ version: "019_dirty.sql", sql: "SELECT 1;", checksum: "dirty-checksum" }]),
    ).rejects.toThrow(`Dirty migration state detected: 019_dirty.sql (${status})`);

    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(execute.mock.calls.some(([sql]) => String(sql).startsWith("INSERT INTO schema_migration"))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE schema_migration"))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes("RELEASE_LOCK"))).toBe(true);
  });

  it("rejects duplicate migration versions before touching the schema", async () => {
    const connection = {
      query: vi.fn(),
      execute: vi.fn(),
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
    } as unknown as MigrationConnection;

    await expect(
      runMigrations(connection, [
        { version: "019_duplicate.sql", sql: "SELECT 1;", checksum: "one" },
        { version: "019_duplicate.sql", sql: "SELECT 2;", checksum: "two" },
      ]),
    ).rejects.toThrow("Duplicate migration version: 019_duplicate.sql");

    expect(connection.query).not.toHaveBeenCalled();
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("rejects an applied migration whose source file is missing", async () => {
    const connection = {
      query: vi.fn(async (sql: string) => (sql.startsWith("SHOW COLUMNS") ? [[{ Field: "checksum" }], []] : [[], []])),
      execute: vi.fn(async (sql: string) => {
        if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }], []];
        if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }], []];
        return [[{ version: "001_missing.sql", checksum: "recorded", status: "APPLIED" }], []];
      }),
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
    } as unknown as MigrationConnection;

    await expect(runMigrations(connection, [])).rejects.toThrow("Applied migration file is missing: 001_missing.sql");

    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });

  it("fails clearly without touching the schema when another runner holds the lock", async () => {
    const execute = vi.fn().mockResolvedValue([[{ acquired: 0 }], []]);
    const connection = {
      query: vi.fn(),
      execute,
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
    } as unknown as MigrationConnection;

    await expect(runMigrations(connection, [], undefined, { lockTimeoutSeconds: 2 })).rejects.toThrow(
      "Could not acquire migration advisory lock within 2 seconds",
    );

    expect(execute).toHaveBeenCalledExactlyOnceWith("SELECT GET_LOCK(?, ?) AS acquired", [
      MIGRATION_ADVISORY_LOCK_NAME,
      2,
    ]);
    expect(connection.query).not.toHaveBeenCalled();
  });

  it("reports a database lock error when GET_LOCK returns null", async () => {
    const connection = {
      query: vi.fn(),
      execute: vi.fn().mockResolvedValue([[{ acquired: null }], []]),
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
    } as unknown as MigrationConnection;

    await expect(runMigrations(connection, [])).rejects.toThrow(
      "Database failed to acquire the migration advisory lock",
    );
  });

  it("surfaces both migration and release failures while still attempting RELEASE_LOCK", async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }], []];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 0 }], []];
      return [[{ version: "001_changed.sql", checksum: "recorded", status: "APPLIED" }], []];
    });
    const connection = {
      query: vi.fn(async (sql: string) => (sql.startsWith("SHOW COLUMNS") ? [[{ Field: "checksum" }], []] : [[], []])),
      execute,
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
    } as unknown as MigrationConnection;

    const error = await runMigrations(connection, [
      { version: "001_changed.sql", sql: "SELECT 1;", checksum: "current" },
    ]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(2);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes("RELEASE_LOCK"))).toBe(true);
  });
});

function normalizedSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}
