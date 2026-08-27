import { ConflictException } from "@nestjs/common";
import type { ExecuteValues, Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../src/auth/auth.types.js";
import { PseudonymsService } from "../src/pseudonyms/pseudonyms.service.js";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

const schedule = {
  examDate: "2036-04-21",
  examTime: "09:00",
  periodName: "통합 1교시",
  admissionName: "통합 전형",
  unitName: "통합 모집단위",
  majorName: "통합 전공",
  buildingName: "통합관",
  roomName: "IT-101",
};

let harness: MariaDbIntegrationHarness;
let actor: AuthenticatedUser;

beforeAll(async () => {
  harness = await createMariaDbIntegrationHarness();
  const [rows] = await harness.pool.execute<Array<RowDataPacket & { id: number }>>(
    "SELECT id FROM app_user WHERE login_id = 'system' LIMIT 1",
  );
  if (!rows[0]) throw new Error("Migration fixture did not create the system account.");
  actor = { id: Number(rows[0].id), loginId: "system", role: "ADMIN", admissionNames: [] };
});

afterAll(async () => {
  if (harness) await harness.cleanup();
});

describe("pseudonym MariaDB transaction integration", () => {
  it("reports version zero for a fallback and creates an exact admission setting at version one", async () => {
    const service = new PseudonymsService(harness.pool);
    const fallback = await service.getSetting("2026년도 자격시험", "신규 전형", actor);
    expect(fallback.version).toBe(0);
    expect(fallback.admissionName).toBe("신규 전형");

    const created = await service.updateSetting(
      {
        ...baseSetting("2026년도 자격시험"),
        admissionName: "신규 전형",
        expectedVersion: fallback.version,
      },
      actor,
    );
    expect(created.version).toBe(1);
    expect(created.admissionName).toBe("신규 전형");
  });

  it("preserves the schedule cursor and rejects a range that excludes assignments", async () => {
    const examName = "IT_CURSOR_EXAM";
    await seedSchedule(harness.pool, examName, [
      { examineeNo: "IT-CURSOR-01", name: "커서 일" },
      { examineeNo: "IT-CURSOR-02", name: "커서 이" },
    ]);
    const service = new PseudonymsService(harness.pool);
    const setting = sequentialSetting(examName, 1001, 1002);
    const createdSetting = await service.updateSetting(setting, actor);
    expect(createdSetting.version).toBe(1);

    const first = await service.assign(assignInput("IT-CURSOR-01"), actor);
    expect(first.pseudonymNumber).toBe("1001");
    expect(await readRange(harness.pool, examName)).toMatchObject({
      rangeStart: 1001,
      rangeEnd: 1002,
      nextSequence: 1002,
    });

    const updatedSetting = await service.updateSetting(
      {
        ...setting,
        expectedVersion: createdSetting.version,
        useCandidatePhotos: false,
      },
      actor,
    );
    expect(updatedSetting.version).toBe(2);
    expect(await readRange(harness.pool, examName)).toMatchObject({
      rangeStart: 1001,
      rangeEnd: 1002,
      nextSequence: 1002,
    });

    const second = await service.assign(assignInput("IT-CURSOR-02"), actor);
    expect(second.pseudonymNumber).toBe("1002");
    expect(await readRange(harness.pool, examName)).toMatchObject({ nextSequence: 1001 });

    await expect(
      service.updateSetting(
        { ...sequentialSetting(examName, 2001, 2002), expectedVersion: updatedSetting.version },
        actor,
      ),
    ).rejects.toThrow("기존 가번호 1001가 변경할 범위에 포함되지 않습니다");
    expect(await readRange(harness.pool, examName)).toMatchObject({
      rangeStart: 1001,
      rangeEnd: 1002,
      nextSequence: 1001,
    });
  });

  it("serializes close ahead of a concurrent assignment on two real connections", async () => {
    const examName = "IT_CLOSE_ASSIGN_EXAM";
    await seedSchedule(harness.pool, examName, [{ examineeNo: "IT-LOCK-01", name: "잠금 수험생" }]);
    await new PseudonymsService(harness.pool).updateSetting(
      {
        ...baseSetting(examName),
        rangeStart: 3001,
        rangeEnd: 3001,
        assignmentMethod: "MATCHING",
        ranges: [],
      },
      actor,
    );
    await harness.pool.execute(
      `INSERT INTO pseudonym_operation
        (exam_name, exam_date, exam_time, period_name, admission_name, closed)
       VALUES (?, ?, ?, ?, ?, FALSE)`,
      operationParams(examName),
    );

    const coordination = createCloseThenAssignPool(harness.pool);
    const service = new PseudonymsService(coordination.pool);
    const closeOutcome = settle(service.closeOperation(operationScope(examName), actor));
    let assignOutcome: Promise<Settled<unknown>> | undefined;

    try {
      await within(coordination.closeOperationLocked, "close operation row lock");
      assignOutcome = settle(
        service.assign(
          {
            ...assignInput("IT-LOCK-01"),
            mode: "MANUAL",
            manualNumber: "3001",
          },
          actor,
        ),
      );
      await within(coordination.assignSharedLockAttempted, "assign shared policy lock attempt");
      coordination.allowCloseToContinue();

      const closeResult = await closeOutcome;
      const assignResult = await assignOutcome;
      expect(closeResult.ok).toBe(true);
      if (closeResult.ok) expect(closeResult.value.closed).toBe(true);
      expect(assignResult.ok).toBe(false);
      if (!assignResult.ok) {
        expect(assignResult.error).toBeInstanceOf(ConflictException);
        expect(String((assignResult.error as Error).message)).toContain("가번호 등록이 마감된 교시");
      }
      expect(new Set(coordination.transactionConnectionIds).size).toBe(2);
    } finally {
      coordination.allowCloseToContinue();
      await Promise.allSettled([closeOutcome, ...(assignOutcome ? [assignOutcome] : [])]);
    }

    const [operations] = await harness.pool.execute<Array<RowDataPacket & { closed: number }>>(
      `SELECT closed FROM pseudonym_operation
       WHERE exam_name = ? AND exam_date = ? AND exam_time = ?
         AND period_name = ? AND admission_name = ?`,
      operationParams(examName),
    );
    const [assignments] = await harness.pool.execute<Array<RowDataPacket & { assignmentCount: number }>>(
      "SELECT COUNT(*) AS assignmentCount FROM pseudonym_assignment WHERE exam_name = ?",
      [examName],
    );
    expect(Boolean(operations[0]?.closed)).toBe(true);
    expect(Number(assignments[0]?.assignmentCount)).toBe(0);
  });

  it("serializes an assignment ahead of a conflicting settings range update", async () => {
    const examName = "IT_ASSIGN_SETTINGS_EXAM";
    const examineeNo = "IT-SETTINGS-01";
    await seedSchedule(harness.pool, examName, [{ examineeNo, name: "설정 경합 수험생" }]);
    const currentSetting = await new PseudonymsService(harness.pool).updateSetting(
      sequentialSetting(examName, 4001, 4001),
      actor,
    );

    const coordination = createAssignThenSettingsPool(harness.pool);
    const service = new PseudonymsService(coordination.pool);
    const assignOutcome = settle(service.assign(assignInput(examineeNo), actor));
    let settingOutcome: Promise<Settled<unknown>> | undefined;

    try {
      await within(coordination.assignSettingLocked, "assignment setting row lock");
      settingOutcome = settle(
        service.updateSetting(
          { ...sequentialSetting(examName, 5001, 5001), expectedVersion: currentSetting.version },
          actor,
        ),
      );
      await within(coordination.settingsSharedLockAttempted, "settings shared policy lock attempt");
      coordination.allowAssignToContinue();

      const [assignResult, settingResult] = await within(
        Promise.all([assignOutcome, settingOutcome]),
        "assign/settings transaction completion",
        10_000,
      );
      expect(assignResult.ok).toBe(true);
      if (assignResult.ok) expect(assignResult.value.pseudonymNumber).toBe("4001");
      expect(settingResult.ok).toBe(false);
      if (!settingResult.ok) {
        expect(settingResult.error).toBeInstanceOf(ConflictException);
        expect(String((settingResult.error as Error).message)).toContain(
          "기존 가번호 4001가 변경할 범위에 포함되지 않습니다",
        );
      }
      expect(new Set(coordination.transactionConnectionIds).size).toBe(2);
    } finally {
      coordination.allowAssignToContinue();
      await Promise.allSettled([assignOutcome, ...(settingOutcome ? [settingOutcome] : [])]);
    }

    expect(await readRange(harness.pool, examName)).toMatchObject({
      rangeStart: 4001,
      rangeEnd: 4001,
      nextSequence: 4001,
    });
    const [assignments] = await harness.pool.execute<
      Array<
        RowDataPacket & {
          pseudonymNumber: string;
          assignmentCount: number;
        }
      >
    >(
      `SELECT MIN(pseudonym_no) AS pseudonymNumber, COUNT(*) AS assignmentCount
       FROM pseudonym_assignment WHERE exam_name = ?`,
      [examName],
    );
    expect(Number(assignments[0]?.assignmentCount)).toBe(1);
    expect(assignments[0]?.pseudonymNumber).toBe("4001");
  });

  it("applies reopen after a concurrently waiting close without losing either transition", async () => {
    const examName = "IT_CLOSE_REOPEN_EXAM";
    await seedSchedule(harness.pool, examName, [{ examineeNo: "IT-REOPEN-01", name: "재개 경합 수험생" }]);
    await new PseudonymsService(harness.pool).updateSetting(
      {
        ...baseSetting(examName),
        rangeStart: 6001,
        rangeEnd: 6001,
        assignmentMethod: "MATCHING",
        ranges: [],
      },
      actor,
    );
    await harness.pool.execute(
      `INSERT INTO pseudonym_operation
        (exam_name, exam_date, exam_time, period_name, admission_name, closed)
       VALUES (?, ?, ?, ?, ?, FALSE)`,
      operationParams(examName),
    );

    const coordination = createCloseThenReopenPool(harness.pool);
    const service = new PseudonymsService(coordination.pool);
    const closeOutcome = settle(service.closeOperation(operationScope(examName), actor));
    let reopenOutcome: Promise<Settled<unknown>> | undefined;

    try {
      await within(coordination.closeOperationLocked, "close operation row lock");
      reopenOutcome = settle(service.reopenOperation(operationScope(examName), actor));
      await within(coordination.reopenSharedLockAttempted, "reopen shared policy lock attempt");
      coordination.allowCloseToContinue();

      const [closeResult, reopenResult] = await within(
        Promise.all([closeOutcome, reopenOutcome]),
        "close/reopen transaction completion",
        10_000,
      );
      expect(closeResult.ok).toBe(true);
      expect(reopenResult.ok).toBe(true);
      expect(new Set(coordination.transactionConnectionIds).size).toBe(2);
    } finally {
      coordination.allowCloseToContinue();
      await Promise.allSettled([closeOutcome, ...(reopenOutcome ? [reopenOutcome] : [])]);
    }

    const [operations] = await harness.pool.execute<
      Array<
        RowDataPacket & {
          closed: number;
          closedAt: Date | null;
          reopenedAt: Date | null;
        }
      >
    >(
      `SELECT closed, closed_at AS closedAt, reopened_at AS reopenedAt
       FROM pseudonym_operation
       WHERE exam_name = ? AND exam_date = ? AND exam_time = ?
         AND period_name = ? AND admission_name = ?`,
      operationParams(examName),
    );
    const [auditRows] = await harness.pool.execute<
      Array<
        RowDataPacket & {
          closeCount: number;
          reopenCount: number;
        }
      >
    >(
      `SELECT
         SUM(event_type = 'PSEUDONYM_OPERATION_CLOSED') AS closeCount,
         SUM(event_type = 'PSEUDONYM_OPERATION_REOPENED') AS reopenCount
       FROM audit_log
       WHERE JSON_UNQUOTE(JSON_EXTRACT(details, '$.admissionName')) = ?
         AND JSON_UNQUOTE(JSON_EXTRACT(details, '$.periodName')) = ?
         AND JSON_UNQUOTE(JSON_EXTRACT(details, '$.examDate')) = ?`,
      [schedule.admissionName, schedule.periodName, schedule.examDate],
    );
    expect(Boolean(operations[0]?.closed)).toBe(false);
    expect(operations[0]?.closedAt).not.toBeNull();
    expect(operations[0]?.reopenedAt).not.toBeNull();
    expect(Number(auditRows[0]?.closeCount)).toBeGreaterThanOrEqual(1);
    expect(Number(auditRows[0]?.reopenCount)).toBeGreaterThanOrEqual(1);
  });

  it("allows only one of two concurrent saves that use the same setting version", async () => {
    const examName = "IT_SETTING_VERSION_EXAM";
    await seedSchedule(harness.pool, examName, []);
    const service = new PseudonymsService(harness.pool);
    const created = await service.updateSetting(baseSetting(examName), actor);

    const firstInput = {
      ...baseSetting(examName),
      expectedVersion: created.version,
      useCandidatePhotos: false,
    };
    const secondInput = {
      ...baseSetting(examName),
      expectedVersion: created.version,
      enableBulkDraw: true,
    };
    const outcomes = await Promise.all([
      settle(service.updateSetting(firstInput, actor)),
      settle(service.updateSetting(secondInput, actor)),
    ]);

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const conflict = outcomes.find((outcome) => !outcome.ok);
    expect(conflict?.ok).toBe(false);
    if (conflict && !conflict.ok) {
      expect(conflict.error).toBeInstanceOf(ConflictException);
      expect(String((conflict.error as Error).message)).toContain("최신 설정을 다시 불러온 뒤 다시 시도해 주세요");
    }
    const latest = await service.getSetting(examName, schedule.admissionName, actor);
    expect(latest.version).toBe(2);
  });
});

async function seedSchedule(pool: Pool, examName: string, candidates: Array<{ examineeNo: string; name: string }>) {
  for (const [index, candidate] of candidates.entries()) {
    await pool.execute(
      `INSERT INTO examinee
        (examinee_no, name, exam_name, exam_date, room_name, seat_no, label_barcode, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [
        candidate.examineeNo,
        candidate.name,
        examName,
        schedule.examDate,
        schedule.roomName,
        String(index + 1),
        `BARCODE-${candidate.examineeNo}`,
      ],
    );
    await pool.execute(
      `INSERT INTO candidate_record
        (designated_sort, admission, unit_name, major, exam_date, start_time,
         period_name, building_name, room_name, examinee_no, name, birth_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2000-01-01')`,
      [
        String(index + 1).padStart(3, "0"),
        schedule.admissionName,
        schedule.unitName,
        schedule.majorName,
        schedule.examDate,
        schedule.examTime,
        schedule.periodName,
        schedule.buildingName,
        schedule.roomName,
        candidate.examineeNo,
        candidate.name,
      ],
    );
  }
}

function baseSetting(examName: string) {
  return {
    expectedVersion: 0,
    examName,
    admissionName: schedule.admissionName,
    rangeStart: 1,
    rangeEnd: 999999,
    assignmentMethod: "MATCHING" as const,
    autoDrawEnabled: false,
    autoDrawDelaySeconds: 3,
    printPreassignedLabel: false,
    autoAssignAbsenteesOnClose: false,
    deleteAbsenteeInfoOnReopen: false,
    useCandidatePhotos: true,
    enableBulkDraw: false,
    ranges: [],
  };
}

function sequentialSetting(examName: string, rangeStart: number, rangeEnd: number) {
  return {
    ...baseSetting(examName),
    rangeStart,
    rangeEnd,
    assignmentMethod: "SEQUENTIAL" as const,
    ranges: [
      {
        date: schedule.examDate,
        time: schedule.examTime,
        period: schedule.periodName,
        admission: schedule.admissionName,
        unit: schedule.unitName,
        major: schedule.majorName,
        building: schedule.buildingName,
        room: schedule.roomName,
        rangeStart,
        rangeEnd,
      },
    ],
  };
}

function assignInput(examineeNo: string) {
  return {
    examineeNo,
    mode: "SEQUENTIAL" as const,
    examDate: schedule.examDate,
    examTime: schedule.examTime,
    periodName: schedule.periodName,
    admissionName: schedule.admissionName,
  };
}

function operationScope(examName: string) {
  return {
    examName,
    examDate: schedule.examDate,
    examTime: schedule.examTime,
    periodName: schedule.periodName,
    admissionName: schedule.admissionName,
  };
}

function operationParams(examName: string) {
  return [examName, schedule.examDate, schedule.examTime, schedule.periodName, schedule.admissionName];
}

async function readRange(pool: Pool, examName: string) {
  const [rows] = await pool.execute<
    Array<
      RowDataPacket & {
        rangeStart: number;
        rangeEnd: number;
        nextSequence: number;
      }
    >
  >(
    `SELECT ptr.range_start AS rangeStart, ptr.range_end AS rangeEnd,
            ptr.next_sequence AS nextSequence
     FROM pseudonym_time_range ptr
     INNER JOIN pseudonym_setting ps ON ps.id = ptr.setting_id
     WHERE ps.exam_name = ? AND ps.admission_name = ? LIMIT 1`,
    [examName, schedule.admissionName],
  );
  if (!rows[0]) throw new Error(`Missing range fixture for ${examName}.`);
  return {
    rangeStart: Number(rows[0].rangeStart),
    rangeEnd: Number(rows[0].rangeEnd),
    nextSequence: Number(rows[0].nextSequence),
  };
}

function createCloseThenAssignPool(underlying: Pool) {
  const closeLocked = deferred();
  const assignAttempted = deferred();
  const continueClose = deferred();
  const coordinated = createTrackedPool(underlying, async ({ ordinal, sql, execute }) => {
    const normalized = normalizeSql(sql);
    if (ordinal === 1 && isOperationLockSql(normalized)) {
      const result = await execute();
      closeLocked.resolve();
      await continueClose.promise;
      return result;
    }
    if (ordinal === 2 && isProfileLockSql(normalized)) {
      assignAttempted.resolve();
    }
    return execute();
  });

  return {
    pool: coordinated.pool,
    closeOperationLocked: closeLocked.promise,
    assignSharedLockAttempted: assignAttempted.promise,
    allowCloseToContinue: continueClose.resolve,
    transactionConnectionIds: coordinated.transactionConnectionIds,
  };
}

function createAssignThenSettingsPool(underlying: Pool) {
  const assignSettingLocked = deferred();
  const settingsLockAttempted = deferred();
  const continueAssign = deferred();
  const coordinated = createTrackedPool(underlying, async ({ ordinal, sql, execute }) => {
    const normalized = normalizeSql(sql);
    if (ordinal === 1 && isSettingLockSql(normalized)) {
      const result = await execute();
      assignSettingLocked.resolve();
      await continueAssign.promise;
      return result;
    }
    if (ordinal === 2 && isProfileLockSql(normalized)) {
      settingsLockAttempted.resolve();
    }
    return execute();
  });

  return {
    pool: coordinated.pool,
    assignSettingLocked: assignSettingLocked.promise,
    settingsSharedLockAttempted: settingsLockAttempted.promise,
    allowAssignToContinue: continueAssign.resolve,
    transactionConnectionIds: coordinated.transactionConnectionIds,
  };
}

function createCloseThenReopenPool(underlying: Pool) {
  const closeLocked = deferred();
  const reopenAttempted = deferred();
  const continueClose = deferred();
  const coordinated = createTrackedPool(underlying, async ({ ordinal, sql, execute }) => {
    const normalized = normalizeSql(sql);
    if (ordinal === 1 && isOperationLockSql(normalized)) {
      const result = await execute();
      closeLocked.resolve();
      await continueClose.promise;
      return result;
    }
    if (ordinal === 2 && isProfileLockSql(normalized)) {
      reopenAttempted.resolve();
    }
    return execute();
  });

  return {
    pool: coordinated.pool,
    closeOperationLocked: closeLocked.promise,
    reopenSharedLockAttempted: reopenAttempted.promise,
    allowCloseToContinue: continueClose.resolve,
    transactionConnectionIds: coordinated.transactionConnectionIds,
  };
}

function createTrackedPool(
  underlying: Pool,
  intercept: (context: { ordinal: number; sql: string; execute: () => Promise<unknown> }) => Promise<unknown>,
) {
  const transactionConnectionIds: number[] = [];
  let ordinal = 0;
  const coordinatedPool = {
    execute: underlying.execute.bind(underlying),
    query: underlying.query.bind(underlying),
    getConnection: async () => {
      const connection = await underlying.getConnection();
      const currentOrdinal = ++ordinal;
      const [idRows] = await connection.query<Array<RowDataPacket & { connectionId: number }>>(
        "SELECT CONNECTION_ID() AS connectionId",
      );
      transactionConnectionIds.push(Number(idRows[0]?.connectionId));
      return wrapConnection(connection, (sql, execute) =>
        intercept({
          ordinal: currentOrdinal,
          sql,
          execute,
        }),
      );
    },
  } as unknown as Pool;
  return { pool: coordinatedPool, transactionConnectionIds };
}

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ");
}

function isOperationLockSql(sql: string) {
  return sql.includes("SELECT id, closed FROM pseudonym_operation") && sql.includes("FOR UPDATE");
}

function isSettingLockSql(sql: string) {
  return sql.includes("FROM pseudonym_setting") && sql.includes("LIMIT 1 FOR UPDATE");
}

function isProfileLockSql(sql: string) {
  return sql.includes("FROM system_profile") && sql.includes("FOR UPDATE");
}

function wrapConnection(
  connection: PoolConnection,
  intercept: (sql: string, execute: () => Promise<unknown>) => Promise<unknown>,
) {
  return {
    beginTransaction: connection.beginTransaction.bind(connection),
    commit: connection.commit.bind(connection),
    rollback: connection.rollback.bind(connection),
    release: connection.release.bind(connection),
    query: connection.query.bind(connection),
    execute: (sql: string, values?: ExecuteValues) => intercept(sql, () => connection.execute(sql, values)),
  } as unknown as PoolConnection;
}

function deferred() {
  let completed = false;
  let complete!: () => void;
  const promise = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return {
    promise,
    resolve: () => {
      if (completed) return;
      completed = true;
      complete();
    },
  };
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

async function within<T>(promise: Promise<T>, label: string, timeoutMs = 5_000) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
