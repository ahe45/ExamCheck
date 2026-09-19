import { performance } from "node:perf_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";
import { CandidatesRepository } from "../src/candidates/candidates.repository.js";
import { CandidatesApplicationService } from "../src/candidates/candidates.application.js";
import { CandidatesService } from "../src/candidates/candidates.service.js";
import { candidateFields, type CandidateInput } from "../src/candidates/candidate-fields.js";
import { parseCandidateListQuery } from "../src/candidates/candidate-list-query.js";
import { MutationAuditRepository } from "../src/common/audit/mutation-audit.repository.js";
import { resolveAppConfig } from "../src/config/app-config.js";
import { PseudonymsService } from "../src/pseudonyms/pseudonyms.service.js";

describe("bounded processing at realistic volumes", () => {
  let harness: MariaDbIntegrationHarness;
  let application: CandidatesApplicationService;
  let service: CandidatesService;
  let actorId: number;
  const repository = new CandidatesRepository();
  const config = resolveAppConfig({ DEFAULT_EXAM_NAME: "Performance fixture" });
  beforeAll(async () => {
    harness = await createMariaDbIntegrationHarness({ connectionLimit: 32 });
    const [users] = await harness.pool.query<RowDataPacket[]>("SELECT id FROM app_user WHERE login_id = 'system'");
    actorId = Number(users[0].id);
    application = new CandidatesApplicationService(harness.pool, repository, new MutationAuditRepository(), config);
    service = new CandidatesService(harness.pool, repository, application, config);
  });
  afterAll(async () => {
    await harness?.cleanup();
  });

  for (const [start, count] of [
    [0, 10000],
    [10000, 20000],
    [30000, 20000],
  ]) {
    it(`imports and pages ${start + count} candidates without returning the whole table`, async () => {
      const started = performance.now();
      const result = await application.importCandidates(
        Array.from({ length: count }, (_, i) => candidate(start + i)),
        "insert-update",
        "a".repeat(64),
        actorId,
      );
      expect(result.inserted).toBe(count);
      const query = parseCandidateListQuery(
        JSON.stringify({ page: 2, pageSize: 30, sort: { key: "designatedSort", direction: "asc" } }),
      );
      const pageStart = performance.now();
      const page = await repository.listPage(harness.pool, query);
      const pageMs = Math.round(performance.now() - pageStart);
      expect(page.total).toBe(start + count);
      expect(page.rows).toHaveLength(30);
      expect(page.rows.map((row) => row.designatedSort)).toEqual(Array.from({ length: 30 }, (_, i) => String(i + 30)));
      if (start + count === 50000) {
        const all = await repository.list(harness.pool);
        console.info(
          JSON.stringify({
            scenario: "response-size",
            rows: all.length,
            fullBytes: Buffer.byteLength(JSON.stringify(all)),
            pageBytes: Buffer.byteLength(JSON.stringify(page)),
          }),
        );
        const [explain] = await harness.pool.query<RowDataPacket[]>(
          "EXPLAIN SELECT id FROM candidate_record WHERE admission = 'scale' AND exam_date = '2039-10-01' AND start_time = '09:00' AND period_name = '1교시' AND status = 'ACTIVE'",
        );
        console.info(JSON.stringify({ scenario: "operation-index", key: explain[0].key, type: explain[0].type }));
      }
      console.info(
        JSON.stringify({
          scenario: "candidate-scale",
          rows: start + count,
          importMs: Math.round(pageStart - started),
          pageMs,
          responseBytes: Buffer.byteLength(JSON.stringify(page)),
        }),
      );
    }, 120000);
  }

  it("streams the filtered export in the same stable order as the page query", async () => {
    const directory = await mkdtemp(join(tmpdir(), "examcheck-it-export-"));
    try {
      const path = join(directory, "result.xlsx");
      const query = JSON.stringify({
        page: 1,
        pageSize: 30,
        filters: { room: ["room1"] },
        sort: { key: "designatedSort", direction: "desc" },
      });
      await service.writeExportFile(query, path);
      const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {});
      let rows = 0;
      let first = "";
      let last = "";
      for await (const sheet of reader)
        for await (const row of sheet) {
          if (rows++ === 0) continue;
          const value = String(row.getCell(1).value);
          if (rows === 2) first = value;
          last = value;
        }
      expect(rows - 1).toBe(500);
      expect(first).toBe("49901");
      expect(last).toBe("1");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  for (const [concurrency, differentScopes] of [
    [10, false],
    [30, false],
    [10, true],
    [30, true],
  ] as const) {
    it(`keeps numbers unique with ${concurrency} concurrent terminals (separate scopes: ${differentScopes})`, async () => {
      const pseudonyms = new PseudonymsService(harness.pool);
      const actor = { id: actorId, loginId: "system", role: "ADMIN" as const, admissionNames: [] };
      const admission = `parallel-${concurrency}-${differentScopes}`;
      const inputs = Array.from({ length: concurrency }, (_, i) => ({
        ...candidate(i),
        examineeNo: `P${concurrency}-${differentScopes}-${i}`,
        admission: differentScopes ? `${admission}-${i}` : admission,
      }));
      await application.importCandidates(inputs, "insert-update", "b".repeat(64), actorId);
      for (const admissionName of new Set(inputs.map((row) => row.admission)))
        await pseudonyms.updateSetting(
          {
            expectedVersion: 0,
            examName: config.candidates.defaultExamName,
            admissionName,
            rangeStart: 1,
            rangeEnd: 99999,
            assignmentMethod: "MATCHING",
            autoDrawEnabled: false,
            autoDrawDelaySeconds: 3,
            printPreassignedLabel: false,
            autoAssignAbsenteesOnClose: false,
            deleteAbsenteeInfoOnReopen: false,
            useCandidatePhotos: true,
            enableBulkDraw: false,
            ranges: inputs
              .map((row, index) => ({
                date: row.date,
                time: row.time,
                period: row.period,
                admission: row.admission,
                unit: row.unit,
                major: row.major,
                building: row.building,
                room: row.room,
                rangeStart: index + 1,
                rangeEnd: index + 1,
              }))
              .filter((range) => range.admission === admissionName),
          },
          actor,
        );
      const durations: number[] = [];
      const results = await Promise.all(
        inputs.map(async (row, index) => {
          const started = performance.now();
          const assigned = await pseudonyms.assign(
            {
              examineeNo: row.examineeNo,
              mode: "MANUAL",
              manualNumber: String(index + 1),
              examDate: row.date,
              examTime: row.time,
              periodName: row.period,
              admissionName: row.admission,
            },
            actor,
          );
          durations.push(performance.now() - started);
          return assigned;
        }),
      );
      expect(new Set(results.map((result) => result.pseudonymNumber)).size).toBe(concurrency);
      durations.sort((a, b) => a - b);
      console.info(
        JSON.stringify({
          scenario: "concurrent-assignment",
          terminals: concurrency,
          differentScopes,
          p95Ms: Math.round(durations[Math.ceil(concurrency * 0.95) - 1]),
          duplicates: 0,
        }),
      );
    }, 60000);
  }
});

function candidate(index: number): CandidateInput {
  return {
    ...Object.fromEntries(candidateFields.map((field) => [field.key, field.sample])),
    designatedSort: String(index),
    date: "2039-10-01",
    time: "09:00",
    period: "1교시",
    admission: "scale",
    room: `room${index % 100}`,
    examineeNo: `S${index.toString().padStart(6, "0")}`,
    temporaryNo: "",
    name: `fixture${index}`,
    birth: "2000-01-01",
  } as CandidateInput;
}
