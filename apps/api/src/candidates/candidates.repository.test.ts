import type { ResultSetHeader } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { candidateFields, candidateKey, type CandidateInput } from "./candidate-fields.js";
import { CandidatesRepository, type CandidateRecordRow } from "./candidates.repository.js";

describe("CandidatesRepository", () => {
  it("aggregates all dashboard breakdowns inside the supplied admission predicate", async () => {
    const repository = new CandidatesRepository();
    const executor = createExecutor({
      executeRows: [
        { groupType: "admission", name: "일반전형", total: "12", assigned: "4" },
        { groupType: "building", name: "본관", total: "7", assigned: "3" },
        { groupType: "period", name: "1교시 · 2026.09.01 09:00", total: "5", assigned: "2" },
        { groupType: "waitingRoom", name: "본관 · 101호 대기실", total: "3", assigned: "1" },
      ],
    });

    await expect(
      repository.listDashboardBreakdownCounts(
        executor.value,
        { sql: "cr.admission IN (?)", params: ["일반전형"] },
        "일반전형",
      ),
    ).resolves.toEqual([
      { groupType: "admission", name: "일반전형", total: 12, assigned: 4 },
      { groupType: "building", name: "본관", total: 7, assigned: 3 },
      { groupType: "period", name: "1교시 · 2026.09.01 09:00", total: 5, assigned: 2 },
      { groupType: "waitingRoom", name: "본관 · 101호 대기실", total: 3, assigned: 1 },
    ]);

    const [sql, values] = executor.execute.mock.calls[0] ?? [];
    expect(sql).toContain("COUNT(DISTINCT cr.id)");
    expect(sql).toContain("cr.building_name");
    expect(sql).toContain("cr.period_name");
    expect(sql).toContain("cr.waiting_room");
    expect(sql).toContain("GROUP BY dashboard_group.group_type, 2");
    expect(sql).toContain("cr.admission IN (?)");
    expect(sql).toContain("AND cr.admission = ?");
    expect(values).toEqual(["일반전형", "일반전형"]);
  });

  it("maps existing candidate rows by the stable schedule key", async () => {
    const repository = new CandidatesRepository();
    const row = recordRow(3);
    const executor = createExecutor({ queryRows: [row] });

    const existing = await repository.loadExisting(executor.value, { forUpdate: false });

    expect(existing.get(candidateKey(row))).toBe(row);
    expect(executor.query).toHaveBeenCalledOnce();
    expect(executor.query.mock.calls[0]?.[0]).not.toContain("FOR UPDATE");
  });

  it("locks existing candidates during imports", async () => {
    const repository = new CandidatesRepository();
    const executor = createExecutor({ queryRows: [recordRow(3)] });

    await repository.loadExisting(executor.value, { forUpdate: true });

    expect(executor.query.mock.calls[0]?.[0]).toContain("FOR UPDATE");
  });

  it("finds protected candidate records without exposing their personal data", async () => {
    const repository = new CandidatesRepository();
    const executor = createExecutor({ executeRows: [{ id: 3 }, { id: 8 }] });

    await expect(
      repository.listOperationallyProtectedCandidateIds(executor.value, [3, 8], "테스트 시험"),
    ).resolves.toEqual(new Set([3, 8]));

    const [sql, values] = executor.execute.mock.calls[0] ?? [];
    expect(sql).toContain("pseudonym_assignment");
    expect(sql).toContain("pseudonym_operation");
    expect(sql).not.toContain("pseudonym_time_range");
    expect(values).toEqual([3, 8, "테스트 시험"]);
  });

  it("loads configured ranges and closed operations as import guards", async () => {
    const repository = new CandidatesRepository();
    const executor = createExecutor({
      executeRows: [
        {
          guardType: "CLOSED",
          date: "2026-09-01",
          time: "09:00",
          period: "1교시",
          admission: "일반전형",
          unit: "",
          major: "",
          building: "",
          room: "",
        },
      ],
    });

    await expect(repository.listImportScopeGuards(executor.value, "테스트 시험")).resolves.toHaveLength(1);
    const [sql, values] = executor.execute.mock.calls[0] ?? [];
    expect(sql).toContain("ptr.id AS rangeId");
    expect(sql).toContain("NULL AS rangeId");
    expect(sql).toContain("pseudonym_time_range");
    expect(sql).toContain("po.closed = TRUE");
    expect(values).toEqual(["테스트 시험", "테스트 시험"]);
  });

  it("deletes only the configured ranges selected by an import plan", async () => {
    const repository = new CandidatesRepository();
    const executor = createExecutor({ executeResult: { affectedRows: 2 } as ResultSetHeader });

    await expect(repository.deleteTimeRangesByIds(executor.value, [13, 21])).resolves.toBe(2);
    expect(executor.execute).toHaveBeenCalledWith("DELETE FROM pseudonym_time_range WHERE id IN (?, ?)", [13, 21]);
  });

  it("locks the developer uniqueness policy only for transactional imports", async () => {
    const repository = new CandidatesRepository();
    const executor = createExecutor({ executeRows: [{ examineeNoUniqueness: "SCHEDULE" }] });

    await expect(repository.loadExamineeNumberUniqueness(executor.value, { forUpdate: true })).resolves.toBe(
      "SCHEDULE",
    );
    expect(executor.execute.mock.calls[0]?.[0]).toContain("FOR UPDATE");

    executor.execute.mockResolvedValueOnce([[], []]);
    await expect(repository.loadExamineeNumberUniqueness(executor.value, { forUpdate: false })).resolves.toBe("SYSTEM");
    expect(executor.execute.mock.calls[1]?.[0]).not.toContain("FOR UPDATE");
  });

  it("writes candidate values in the declared field order and returns the inserted id", async () => {
    const repository = new CandidatesRepository();
    const executor = createExecutor({ executeResult: { insertId: 42 } as ResultSetHeader });
    const input = candidate();

    await expect(repository.insertCandidate(executor.value, input, "테스트 시험")).resolves.toBe(42);

    const [sql, values] = executor.execute.mock.calls[0] ?? [];
    expect(sql).toContain(candidateFields.map((field) => field.dbColumn).join(", "));
    expect(values).toEqual([...candidateFields.map((field) => input[field.key]), "테스트 시험", input.examineeNo]);
  });

  it("uses the same field definitions for update values and read aliases", async () => {
    const repository = new CandidatesRepository();
    const executor = createExecutor({ queryRows: [], executeResult: { affectedRows: 1 } as ResultSetHeader });
    const input = candidate({
      designatedSort: "17",
      temporaryNo: "T-17",
      group: "검증조",
      opt1: "선택값1",
      opt2: "선택값2",
      opt3: "선택값3",
    });

    await repository.updateCandidate(executor.value, 91, input, "테스트 시험");
    await repository.list(executor.value);

    const [updateStatement, updateValues] = executor.execute.mock.calls[0] ?? [];
    expect(updateStatement).toContain(candidateFields.map((field) => `${field.dbColumn} = ?`).join(", "));
    expect(updateValues).toEqual([
      ...candidateFields.map((field) => input[field.key]),
      "테스트 시험",
      input.examineeNo,
      91,
    ]);

    const selectStatement = String(executor.query.mock.calls[0]?.[0]);
    for (const field of candidateFields) {
      const expectedAlias =
        field.format === "date"
          ? `COALESCE(DATE_FORMAT(cr.${field.dbColumn}, '%Y-%m-%d'), '') AS \`${field.key}\``
          : `cr.${field.dbColumn} AS \`${field.key}\``;
      expect(selectStatement).toContain(expectedAlias);
    }
  });

  it("uses the supplied executor for locked photo reads and photo upserts", async () => {
    const repository = new CandidatesRepository();
    const executor = createExecutor({ queryRows: [{ id: 4, examineeNo: "10001", photoHash: null }] });
    const photo = {
      fileName: "10001.png",
      mimeType: "image/png",
      content: Buffer.from("photo"),
      contentHash: "hash",
    };

    await expect(repository.listCandidatePhotos(executor.value, { forUpdate: true })).resolves.toHaveLength(1);
    expect(executor.query.mock.calls[0]?.[0]).toContain("FOR UPDATE");

    await repository.upsertCandidatePhoto(executor.value, 4, photo);
    expect(executor.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO candidate_photo"), [
      4,
      "10001.png",
      "image/png",
      photo.content,
      "hash",
    ]);
  });
});

function createExecutor(options: { queryRows?: unknown[]; executeRows?: unknown[]; executeResult?: ResultSetHeader }) {
  const query = vi.fn().mockResolvedValue([options.queryRows ?? [], []]);
  const execute = vi
    .fn()
    .mockResolvedValue([options.executeRows ?? options.executeResult ?? ({ affectedRows: 1 } as ResultSetHeader), []]);
  return { query, execute, value: { query, execute } as unknown as SqlExecutor };
}

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    designatedSort: "",
    date: "2026-09-01",
    time: "09:00",
    period: "1교시",
    admission: "일반전형",
    unit: "디자인학부",
    major: "",
    building: "본관",
    waitingRoom: "본관 대기실",
    room: "101호",
    examineeNo: "10001",
    temporaryNo: "",
    name: "홍길동",
    birth: "2000-01-01",
    group: "",
    opt1: "",
    opt2: "",
    opt3: "",
    ...overrides,
  };
}

function recordRow(id: number): CandidateRecordRow {
  return {
    ...candidate(),
    id,
    assignedNumber: null,
    assignedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as CandidateRecordRow;
}
