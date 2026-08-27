import type { ResultSetHeader } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { candidateFields, candidateKey, type CandidateInput } from "./candidate-fields.js";
import { CandidatesRepository, type CandidateRecordRow } from "./candidates.repository.js";

describe("CandidatesRepository", () => {
  it("aggregates dashboard counts inside the supplied admission predicate", async () => {
    const repository = new CandidatesRepository();
    const executor = createExecutor({
      executeRows: [{ name: "일반전형", total: "12", assigned: "4" }],
    });

    await expect(
      repository.listDashboardAdmissionCounts(
        executor.value,
        { sql: "cr.admission IN (?)", params: ["일반전형"] },
        "일반전형",
      ),
    ).resolves.toEqual([{ name: "일반전형", total: 12, assigned: 4 }]);

    const [sql, values] = executor.execute.mock.calls[0] ?? [];
    expect(sql).toContain("COUNT(DISTINCT cr.id)");
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
    expect(sql).toContain("pseudonym_time_range");
    expect(values).toEqual([3, 8, "테스트 시험", "테스트 시험"]);
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
    expect(sql).toContain("pseudonym_time_range");
    expect(sql).toContain("po.closed = TRUE");
    expect(values).toEqual(["테스트 시험", "테스트 시험"]);
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

    await expect(repository.insertCandidate(executor.value, input)).resolves.toBe(42);

    const [sql, values] = executor.execute.mock.calls[0] ?? [];
    expect(sql).toContain(`(${candidateFields.map((field) => field.dbColumn).join(", ")})`);
    expect(values).toEqual(candidateFields.map((field) => input[field.key]));
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

    await repository.updateCandidate(executor.value, 91, input);
    await repository.list(executor.value);

    const [updateStatement, updateValues] = executor.execute.mock.calls[0] ?? [];
    expect(updateStatement).toContain(candidateFields.map((field) => `${field.dbColumn} = ?`).join(", "));
    expect(updateValues).toEqual([...candidateFields.map((field) => input[field.key]), 91]);

    const selectStatement = String(executor.query.mock.calls[0]?.[0]);
    for (const field of candidateFields) {
      const expectedAlias =
        field.format === "date"
          ? `DATE_FORMAT(cr.${field.dbColumn}, '%Y-%m-%d') AS \`${field.key}\``
          : `cr.${field.dbColumn} AS \`${field.key}\``;
      expect(selectStatement).toContain(expectedAlias);
    }
  });

  it("keeps the legacy examinee compatibility row aligned with the current exam context", async () => {
    const repository = new CandidatesRepository();
    const executor = createExecutor({});

    await repository.syncOperationalExaminee(executor.value, candidate(), "테스트 시험");

    expect(executor.execute.mock.calls[0]?.[0]).toContain("exam_name = VALUES(exam_name)");
    expect(executor.execute.mock.calls[0]?.[1]?.[2]).toBe("테스트 시험");
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
