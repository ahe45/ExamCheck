import type { Pool, ResultSetHeader } from "mysql2/promise";
import { describe, expect, it } from "vitest";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { pseudonymUniquenessScopeKey } from "../uniqueness/number-uniqueness.js";
import { PseudonymsRepository } from "./pseudonyms.repository.js";

const operationScope = {
  examName: "2026학년도",
  examDate: "2026-09-01",
  examTime: "09:00",
  periodName: "1교시",
  admissionName: "일반전형",
};

describe("PseudonymsRepository SQL mapping", () => {
  it("loads settings overview candidates, settings and ranges with fixed batch queries", async () => {
    const repository = new PseudonymsRepository();
    const executor = new FixtureExecutor([
      [
        {
          name: "일반전형",
          candidates: "12",
          dates: "2",
          schedules: "3",
          buildings: "본관\u001f별관",
        },
      ],
      [repositorySettingFixture({ admissionName: "일반전형" })],
      [
        {
          settingId: 9,
          id: 91,
          date: "2026-09-01",
          time: "09:00",
          period: "1교시",
          admission: "일반전형",
          unit: "디자인",
          major: "",
          building: "본관",
          room: "101호",
          scheduleKey: "schedule-key",
          rangeStart: 1001,
          rangeEnd: 1012,
          nextSequence: 1001,
        },
      ],
    ]);
    const access = { sql: "cr.admission IN (?)" as const, params: ["일반전형"] };

    await expect(repository.listAdmissionSettingsOverview(executor, access)).resolves.toEqual([
      {
        name: "일반전형",
        candidates: 12,
        dates: 2,
        schedules: 3,
        buildings: ["본관", "별관"],
      },
    ]);
    await expect(repository.listSettingsForOverview(executor, "2026 실기", ["일반전형"])).resolves.toHaveLength(1);
    await expect(repository.listTimeRangesForOverview(executor, [9], ["일반전형"])).resolves.toHaveLength(1);

    expect(executor.calls).toHaveLength(3);
    expect(executor.calls[0]?.sql).toContain("WHERE cr.admission IN (?)");
    expect(executor.calls[0]?.parameters).toEqual(["일반전형"]);
    expect(executor.calls[1]?.sql).toContain("admission_name IN (?, ?)");
    expect(executor.calls[1]?.parameters).toEqual(["2026 실기", "", "일반전형"]);
    expect(executor.calls[2]?.sql).toContain("setting_id IN (?)");
    expect(executor.calls[2]?.parameters).toEqual([9, "일반전형"]);
  });

  it("adds a row lock only to transactional setting reads", async () => {
    const repository = new PseudonymsRepository();
    const executor = new FixtureExecutor([[], []]);

    await repository.findSetting(executor, operationScope.examName, operationScope.admissionName, {
      forUpdate: false,
    });
    await repository.findSetting(executor, operationScope.examName, operationScope.admissionName, { forUpdate: true });

    expect(executor.calls[0]?.sql).not.toContain("FOR UPDATE");
    expect(executor.calls[1]?.sql).toContain("FOR UPDATE");
    expect(executor.calls[1]?.parameters).toEqual([
      operationScope.examName,
      operationScope.admissionName,
      operationScope.admissionName,
    ]);
  });

  it("keeps operation creation and locking as separate ordered repository calls", async () => {
    const repository = new PseudonymsRepository();
    const executor = new FixtureExecutor([{ affectedRows: 1 } as ResultSetHeader, [{ id: 7, closed: false }]]);

    await repository.ensureOperation(executor, operationScope);
    await expect(repository.lockOperation(executor, operationScope)).resolves.toMatchObject({ id: 7, closed: false });

    expect(executor.calls.map((call) => call.sql)).toEqual([
      expect.stringContaining("INSERT IGNORE INTO pseudonym_operation"),
      expect.stringContaining("LIMIT 1 FOR UPDATE"),
    ]);
    expect(executor.calls.every((call) => call.parameters?.join("|") === operationParameters().join("|"))).toBe(true);
  });

  it("loads reserved numbers with the configured schedule scope key", async () => {
    const repository = new PseudonymsRepository();
    const executor = new FixtureExecutor([[{ pseudonymNumber: "1001" }, { pseudonymNumber: "1002" }]]);
    const schedule = {
      date: operationScope.examDate,
      time: operationScope.examTime,
      period: operationScope.periodName,
      admission: operationScope.admissionName,
    };

    await expect(
      repository.loadReservedNumbers(
        executor,
        operationScope.examName,
        operationScope.admissionName,
        "SCHEDULE",
        schedule,
      ),
    ).resolves.toEqual(new Set([1001, 1002]));

    expect(executor.calls[0]?.parameters).toEqual([
      operationScope.examName,
      operationScope.admissionName,
      pseudonymUniquenessScopeKey("SCHEDULE", schedule),
      "SCHEDULE",
      operationScope.admissionName,
      "SCHEDULE",
      operationScope.examDate,
      operationScope.examTime,
      operationScope.periodName,
      operationScope.examName,
    ]);
    expect(executor.calls[0]?.sql).toContain("candidate_record_id IS NULL");
  });

  it("requeries export rows from the exact exam and schedule using parameterized allowlisted filters", async () => {
    const repository = new PseudonymsRepository();
    const executor = new FixtureExecutor([[]]);

    await repository.listOperationRoster(executor, operationScope, [
      { field: "status", mode: "include", values: ["등록"] },
      { field: "majorName", mode: "exclude", values: ["-"] },
    ]);

    const call = executor.calls[0];
    expect(call?.sql).toContain("INNER JOIN examinee e");
    expect(call?.sql).toContain("e.exam_name = ?");
    expect(call?.sql).toContain("e.status = 'ACTIVE'");
    expect(call?.sql).toContain("cr.exam_date = ?");
    expect(call?.sql).toContain("cr.start_time = ?");
    expect(call?.sql).toContain("cr.period_name = ?");
    expect(call?.sql).toContain("cr.admission = ?");
    expect(call?.sql).toContain("LIMIT 10001");
    expect(call?.parameters).toEqual([...operationParameters(), "등록", "-"]);
  });

  it("resolves assignment candidates by candidate_record schedule fields", async () => {
    const repository = new PseudonymsRepository();
    const executor = new FixtureExecutor([
      [
        {
          id: 8,
          candidateRecordId: 208,
          examineeNo: "10001",
          name: "일정별 수험생",
          examName: operationScope.examName,
          preassignedNumber: "2201",
          examDate: operationScope.examDate,
          examTime: operationScope.examTime,
          period: operationScope.periodName,
          admission: operationScope.admissionName,
          unit: "디자인",
          major: "시각디자인",
          building: "예술관",
          room: "202호",
        },
      ],
    ]);

    await expect(
      repository.findCandidateInScope(
        executor,
        {
          examName: operationScope.examName,
          examineeNo: " 10001 ",
          mode: "PREASSIGNED",
          examDate: operationScope.examDate,
          examTime: operationScope.examTime,
          periodName: operationScope.periodName,
          admissionName: operationScope.admissionName,
        },
        { forUpdate: true },
      ),
    ).resolves.toMatchObject({ candidateRecordId: 208, name: "일정별 수험생", room: "202호" });

    const call = executor.calls[0];
    expect(call?.sql).toContain("cr.id AS candidateRecordId");
    expect(call?.sql).toContain("COALESCE(NULLIF(?, ''), e.exam_name) AS examName");
    expect(call?.sql).toContain("cr.name");
    expect(call?.sql).toContain("NULLIF(cr.temporary_no");
    expect(call?.sql).toContain("cr.building_name AS building");
    expect(call?.sql).toContain("cr.room_name AS room");
    expect(call?.sql).not.toContain("e.name");
    expect(call?.sql).not.toContain("e.room_name");
    expect(call?.sql).toContain("FOR UPDATE");
    expect(call?.parameters).toEqual([
      operationScope.examName,
      "10001",
      operationScope.examDate,
      operationScope.examTime,
      operationScope.periodName,
      operationScope.admissionName,
    ]);
  });

  it("keeps legacy assignment clients compatible when examName is omitted", async () => {
    const repository = new PseudonymsRepository();
    const executor = new FixtureExecutor([[]]);

    await repository.findCandidateInScope(
      executor,
      {
        examineeNo: "10001",
        mode: "MANUAL",
        manualNumber: "1001",
        examDate: operationScope.examDate,
        examTime: operationScope.examTime,
        periodName: operationScope.periodName,
        admissionName: operationScope.admissionName,
      },
      { forUpdate: false },
    );

    expect(executor.calls[0]?.sql).toContain("COALESCE(NULLIF(?, ''), e.exam_name) AS examName");
    expect(executor.calls[0]?.parameters?.[0]).toBe("");
  });

  it("returns mutation result metadata without owning the transaction", async () => {
    const repository = new PseudonymsRepository();
    const executor = new FixtureExecutor([
      { affectedRows: 1 } as ResultSetHeader,
      { insertId: 42 } as ResultSetHeader,
      { affectedRows: 3 } as ResultSetHeader,
    ]);
    const settingInput = {
      expectedVersion: 3,
      examName: operationScope.examName,
      admissionName: operationScope.admissionName,
      rangeStart: 1001,
      rangeEnd: 1030,
      assignmentMethod: "DRAW" as const,
      autoDrawEnabled: true,
      autoDrawDelaySeconds: 3,
      printPreassignedLabel: false,
      autoAssignAbsenteesOnClose: true,
      deleteAbsenteeInfoOnReopen: false,
      useCandidatePhotos: true,
      enableBulkDraw: false,
      ranges: [],
    };

    await expect(repository.updateSetting(executor, 9, 3, 1001, settingInput, 2)).resolves.toBe(1);
    await expect(repository.insertSetting(executor, 1001, settingInput, 2)).resolves.toBe(42);
    await expect(repository.deleteAutoAssignedAbsentees(executor, operationScope)).resolves.toBe(3);

    expect(executor.calls.map((call) => call.sql)).toEqual([
      expect.stringContaining("version = version + 1"),
      expect.stringContaining("INSERT INTO pseudonym_setting"),
      expect.stringContaining("DELETE pa FROM pseudonym_assignment"),
    ]);
  });
});

class FixtureExecutor implements SqlExecutor {
  readonly calls: Array<{ sql: string; parameters?: unknown[] }> = [];

  constructor(private readonly resultSets: unknown[]) {}

  query: Pool["query"] = ((sql: string, parameters?: unknown[]) => {
    this.calls.push({ sql, parameters });
    return Promise.resolve([this.resultSets.shift(), []]);
  }) as unknown as Pool["query"];

  execute: Pool["execute"] = ((sql: string, parameters?: unknown[]) => {
    this.calls.push({ sql, parameters });
    return Promise.resolve([this.resultSets.shift(), []]);
  }) as unknown as Pool["execute"];
}

function operationParameters() {
  return [
    operationScope.examName,
    operationScope.examDate,
    operationScope.examTime,
    operationScope.periodName,
    operationScope.admissionName,
  ];
}

function repositorySettingFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    version: 1,
    examName: operationScope.examName,
    admissionName: operationScope.admissionName,
    rangeStart: 1001,
    rangeEnd: 1030,
    nextSequence: 1001,
    assignmentMethod: "DRAW",
    autoDrawEnabled: true,
    autoDrawDelaySeconds: 3,
    printPreassignedLabel: false,
    autoAssignAbsenteesOnClose: false,
    deleteAbsenteeInfoOnReopen: false,
    useCandidatePhotos: true,
    enableBulkDraw: false,
    ...overrides,
  };
}
