import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import type { Pool } from "mysql2/promise";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAppConfig } from "../config/app-config.js";
import type { CandidatesApplicationService } from "./candidates.application.js";
import type { CandidatesRepository } from "./candidates.repository.js";
import { CandidatesService } from "./candidates.service.js";
import { candidateFields } from "./candidate-fields.js";

describe("candidate streaming export", () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  async function outputPath() {
    const directory = await mkdtemp(join(tmpdir(), "examcheck-export-test-"));
    directories.push(directory);
    return join(directory, "export.xlsx");
  }

  it("exports all batches in one read snapshot and preserves number strings and query conditions", async () => {
    const fixture = createFixture();
    const rows = Array.from({ length: 501 }, (_, index) => ({
      examineeNo: String(index + 1).padStart(6, "0"),
      name: `수험생 ${index + 1}`,
      temporaryNo: index === 500 ? "0009" : "",
    }));
    fixture.repository.exportBatch.mockResolvedValueOnce(rows.slice(0, 500)).mockResolvedValueOnce(rows.slice(500));
    const query = {
      page: 2,
      pageSize: 30,
      sort: { key: "examineeNo", direction: "asc" },
      filters: { admission: ["일반"] },
    };
    const path = await outputPath();
    const progress = vi.fn(async () => {});

    await fixture.service.writeExportFile(JSON.stringify(query), path, progress);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await readFile(path)) as never);
    const sheet = workbook.worksheets[0]!;
    const column = (key: string) => candidateFields.findIndex((field) => field.key === key) + 1;
    expect(sheet.rowCount).toBe(502);
    expect(sheet.getRow(2).getCell(column("examineeNo")).value).toBe("000001");
    expect(sheet.getRow(502).getCell(column("temporaryNo")).value).toBe("0009");
    expect(fixture.repository.exportBatch.mock.calls.map((call) => call[2])).toEqual([0, 500]);
    expect(fixture.repository.exportBatch).toHaveBeenCalledWith(fixture.connection, query, 0);
    expect(progress.mock.calls).toEqual([[500], [501]]);
    expect(fixture.connection.query.mock.calls).toEqual([
      ["SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"],
      ["START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"],
    ]);
    expect(fixture.connection.commit).toHaveBeenCalledOnce();
    expect(fixture.connection.rollback).not.toHaveBeenCalled();
    expect(fixture.connection.release).toHaveBeenCalledOnce();
  });

  it("returns a valid header-only workbook for an empty filtered result", async () => {
    const fixture = createFixture();
    const stream = await fixture.service.streamExport();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.concat(chunks) as never);
    expect(workbook.worksheets[0]!.rowCount).toBe(1);
    expect(workbook.worksheets[0]!.getRow(1).values).toEqual([
      undefined,
      ...candidateFields.map((field) => field.label),
    ]);
    expect(fixture.connection.release).toHaveBeenCalledOnce();
  });

  it.each(["query", "progress", "commit"] as const)(
    "rolls back and releases the connection after a %s failure",
    async (stage) => {
      const fixture = createFixture();
      const error = new Error(`${stage} failed`);
      if (stage === "query") fixture.repository.exportBatch.mockRejectedValueOnce(error);
      if (stage === "commit") fixture.connection.commit.mockRejectedValueOnce(error);
      const progress = vi.fn(async () => {
        if (stage === "progress") throw error;
      });
      // A secondary cleanup error must not hide the original cause.
      fixture.connection.rollback.mockRejectedValueOnce(new Error("rollback failed"));
      await expect(fixture.service.writeExportFile(undefined, await outputPath(), progress)).rejects.toBe(error);
      expect(fixture.connection.rollback).toHaveBeenCalledOnce();
      expect(fixture.connection.release).toHaveBeenCalledOnce();
    },
  );

  it("rejects malformed export conditions before acquiring a connection", async () => {
    const fixture = createFixture();
    await expect(fixture.service.streamExport("not-json")).rejects.toThrow("조회 조건을 확인해 주세요.");
    expect(fixture.pool.getConnection).not.toHaveBeenCalled();
  });
});

function createFixture() {
  const connection = {
    query: vi.fn(async (_sql: string) => [[], []]),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(),
  };
  const pool = { getConnection: vi.fn(async () => connection) };
  const repository = {
    exportBatch: vi.fn<(...args: unknown[]) => Promise<Record<string, string>[]>>().mockResolvedValue([]),
  };
  const service = new CandidatesService(
    pool as unknown as Pool,
    repository as unknown as CandidatesRepository,
    {} as CandidatesApplicationService,
    resolveAppConfig({ JWT_SECRET: "export-tests-secret-at-least-thirty-two-characters" }),
  );
  return { connection, pool, repository, service };
}
