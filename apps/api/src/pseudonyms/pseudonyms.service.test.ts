import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { hashPassword } from "../auth/password.js";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { PseudonymRosterExporter } from "./pseudonym-roster-exporter.js";
import {
  AssignPseudonymUseCase,
  ChangePseudonymOperationStatusUseCase,
  UpdatePseudonymSettingUseCase,
} from "./pseudonyms.application.js";
import { PseudonymsRepository } from "./pseudonyms.repository.js";
import { ensureAndLockOperation, PseudonymsService } from "./pseudonyms.service.js";

describe("PseudonymsService admission authorization", () => {
  const restrictedUser = {
    id: 7,
    loginId: "operator",
    role: "OPERATOR" as const,
    admissionNames: ["배정 전형"],
  };
  const inaccessibleScope = {
    examName: "2026 실기",
    examDate: "2026-08-11",
    examTime: "09:00",
    periodName: "1교시",
    admissionName: "다른 전형",
  };
  const pool = {
    execute: async () => {
      throw new Error("authorization must run before a database query");
    },
    getConnection: async () => {
      throw new Error("authorization must run before a transaction");
    },
  } as unknown as Pool;

  it("rejects reading another admission's setting before querying the database", async () => {
    await expect(
      new PseudonymsService(pool).getSetting(
        inaccessibleScope.examName,
        inaccessibleScope.admissionName,
        restrictedUser,
      ),
    ).rejects.toThrow("배정되지 않은 전형의 설정은 조회할 수 없습니다.");
  });

  it("rejects reading another admission's operation status before querying the database", async () => {
    await expect(new PseudonymsService(pool).getOperationStatus(inaccessibleScope, restrictedUser)).rejects.toThrow(
      "배정되지 않은 전형의 운영 상태는 조회할 수 없습니다.",
    );
  });

  it("rejects exporting another admission's roster before creating the workbook", async () => {
    await expect(
      new PseudonymsService(pool).buildOperationRosterExport(
        {
          ...inaccessibleScope,
          query: { filters: [] },
        },
        restrictedUser,
      ),
    ).rejects.toThrow("배정되지 않은 전형의 가번호 등록 현황은 다운로드할 수 없습니다.");
  });

  it("rejects closing another admission's operation before opening a transaction", async () => {
    await expect(new PseudonymsService(pool).closeOperation(inaccessibleScope, restrictedUser)).rejects.toThrow(
      "배정되지 않은 전형의 운영 상태를 변경할 수 없습니다.",
    );
  });

  it("rejects changing another admission's setting before opening a transaction", async () => {
    await expect(
      new PseudonymsService(pool).updateSetting(
        {
          expectedVersion: 0,
          examName: inaccessibleScope.examName,
          admissionName: inaccessibleScope.admissionName,
          rangeStart: 1,
          rangeEnd: 1,
          assignmentMethod: "MATCHING",
          autoDrawEnabled: false,
          autoDrawDelaySeconds: 3,
          printPreassignedLabel: false,
          autoAssignAbsenteesOnClose: false,
          deleteAbsenteeInfoOnReopen: false,
          useCandidatePhotos: true,
          enableBulkDraw: false,
          ranges: [],
        },
        restrictedUser,
      ),
    ).rejects.toThrow("배정되지 않은 전형의 설정은 변경할 수 없습니다.");
  });

  it("rejects assigning another admission's candidate before opening a transaction", async () => {
    await expect(
      new PseudonymsService(pool).assign(
        {
          examineeNo: "10001",
          mode: "MANUAL",
          manualNumber: "1001",
          examDate: inaccessibleScope.examDate,
          examTime: inaccessibleScope.examTime,
          periodName: inaccessibleScope.periodName,
          admissionName: inaccessibleScope.admissionName,
        },
        restrictedUser,
      ),
    ).rejects.toThrow("배정되지 않은 전형의 수험생에게 가번호를 부여할 수 없습니다.");
  });
});

describe("PseudonymsService settings overview", () => {
  it("combines exact and global settings from fixed batch repository reads", async () => {
    const exact = settingFixture({ id: 10, version: 4, admissionName: "A전형" });
    const fallback = settingFixture({ id: 1, version: 7, admissionName: "" });
    const repository = {
      listAdmissionSettingsOverview: vi.fn().mockResolvedValue([
        { name: "A전형", candidates: 2, dates: 1, schedules: 1, buildings: ["본관"] },
        { name: "B전형", candidates: 3, dates: 2, schedules: 2, buildings: ["별관"] },
      ]),
      listSettingsForOverview: vi.fn().mockResolvedValue([fallback, exact]),
      listRangeSummariesForOverview: vi.fn().mockResolvedValue([
        { ...overviewRange(10, "A전형", 1001), count: 1, start: 1001, end: 1010 },
        { ...overviewRange(1, "B전형", 2001), count: 1, start: 2001, end: 2010 },
      ]),
    };
    const service = new PseudonymsService({} as Pool, repository as unknown as PseudonymsRepository);
    const admin = { id: 1, loginId: "admin", role: "ADMIN" as const, admissionNames: [] };

    const result = await service.getSettingsOverview(" 2026 실기 ", admin);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: "A전형",
      setting: { id: 10, version: 4, admissionName: "A전형", ranges: [], rangeStatistics: { count: 1 } },
      error: false,
    });
    expect(result[1]).toMatchObject({
      name: "B전형",
      setting: { id: 1, version: 0, admissionName: "B전형", ranges: [], rangeStatistics: { count: 1 } },
      error: false,
    });
    expect(repository.listAdmissionSettingsOverview).toHaveBeenCalledWith({}, { sql: "1 = 1", params: [] });
    expect(repository.listSettingsForOverview).toHaveBeenCalledWith({}, "2026 실기", ["A전형", "B전형"]);
    expect(repository.listRangeSummariesForOverview).toHaveBeenCalledWith({}, [10, 1], ["A전형", "B전형"]);
  });

  it("passes the account admission predicate to the overview projection and marks missing settings", async () => {
    const repository = {
      listAdmissionSettingsOverview: vi
        .fn()
        .mockResolvedValue([{ name: "배정 전형", candidates: 1, dates: 1, schedules: 1, buildings: [] }]),
      listSettingsForOverview: vi.fn().mockResolvedValue([]),
      listRangeSummariesForOverview: vi.fn().mockResolvedValue([]),
    };
    const service = new PseudonymsService({} as Pool, repository as unknown as PseudonymsRepository);
    const user = { id: 7, loginId: "operator", role: "OPERATOR" as const, admissionNames: ["배정 전형"] };

    await expect(service.getSettingsOverview("2026 실기", user)).resolves.toEqual([
      {
        name: "배정 전형",
        candidates: 1,
        dates: 1,
        schedules: 1,
        buildings: [],
        setting: null,
        error: true,
      },
    ]);
    expect(repository.listAdmissionSettingsOverview).toHaveBeenCalledWith(
      {},
      {
        sql: "cr.admission IN (?)",
        params: ["배정 전형"],
      },
    );
    expect(repository.listRangeSummariesForOverview).toHaveBeenCalledWith({}, [], ["배정 전형"]);
  });
});

describe("PseudonymsService admission data actions", () => {
  const admin = { id: 1, loginId: "admin", role: "ADMIN" as const, admissionNames: [] };

  it.each(["reset", "delete"] as const)(
    "blocks %s before any data access when reset password is missing, wrong, or unconfigured",
    async (action) => {
      for (const scenario of ["unconfigured", "missing", "wrong"] as const) {
        const connection = transactionConnection();
        const repository = {
          findHistoryResetPasswordForUpdate: vi
            .fn()
            .mockResolvedValue(scenario === "unconfigured" ? null : await hashPassword("reset-secret")),
          findUserPasswordForUpdate: vi.fn().mockResolvedValue(await hashPassword("login-password")),
          listAdmissionOperationSchedules: vi.fn(),
          lockAdmissionCandidateIds: vi.fn(),
        };
        const audit = { record: vi.fn() };
        const service = admissionActionService(connection, repository, audit);
        const input = {
          examName: "2026년도 자격시험",
          admissionName: "학생부교과",
          schedules: [{ examDate: "2026-09-01", examTime: "09:00", periodName: "1교시" }],
          password: scenario === "missing" ? undefined! : "login-password",
        };
        const request =
          action === "reset" ? service.resetAdmissionOperations(input, admin) : service.deleteAdmission(input, admin);
        await expect(request).rejects.toThrow(scenario === "unconfigured" ? "먼저 설정" : "초기화 비밀번호가 올바르지");
        expect(repository.findUserPasswordForUpdate).not.toHaveBeenCalled();
        expect(repository.listAdmissionOperationSchedules).not.toHaveBeenCalled();
        expect(repository.lockAdmissionCandidateIds).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
        expect(connection.commit).not.toHaveBeenCalled();
        expect(connection.rollback).toHaveBeenCalledOnce();
      }
    },
  );

  it("resets assignments, closure state, and range cursors only for selected schedules", async () => {
    const connection = transactionConnection();
    const repository = {
      findHistoryResetPasswordForUpdate: vi.fn().mockResolvedValue(await hashPassword("reset-password")),
      listAdmissionOperationSchedules: vi.fn().mockResolvedValue([
        {
          examDate: "2026-09-01",
          examTime: "09:00",
          periodName: "1교시",
          buildingNames: ["본관"],
          candidateCount: 10,
          assignedCount: 7,
          closed: true,
        },
      ]),
      deleteScheduleAssignments: vi.fn().mockResolvedValue(7),
      deleteScheduleOperations: vi.fn().mockResolvedValue(1),
      resetScheduleRangeSequences: vi.fn().mockResolvedValue(2),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = admissionActionService(connection, repository, audit);
    const schedules = [{ examDate: "2026-09-01", examTime: "09:00", periodName: "1교시" }];

    await expect(
      service.resetAdmissionOperations(
        { examName: "2026년도 자격시험", admissionName: "학생부교과", schedules, password: "reset-password" },
        admin,
      ),
    ).resolves.toEqual({
      resetScheduleCount: 1,
      deletedAssignmentCount: 7,
      deletedOperationCount: 1,
      resetRangeCount: 2,
    });

    expect(repository.deleteScheduleAssignments).toHaveBeenCalledWith(
      connection,
      "2026년도 자격시험",
      "학생부교과",
      schedules,
    );
    expect(repository.resetScheduleRangeSequences).toHaveBeenCalledWith(
      connection,
      "2026년도 자격시험",
      "학생부교과",
      schedules,
      1,
    );
    expect(audit.record).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({ eventType: "PSEUDONYM_OPERATIONS_RESET", actorUserId: 1 }),
    );
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it("verifies the developer-configured reset password before deleting every admission-owned data set", async () => {
    const connection = transactionConnection();
    const repository = {
      findHistoryResetPasswordForUpdate: vi.fn().mockResolvedValue(await hashPassword("1234")),
      lockAdmissionCandidateIds: vi.fn().mockResolvedValue([11, 12]),
      deleteAdmissionAssignments: vi.fn().mockResolvedValue(2),
      deleteAdmissionOperations: vi.fn().mockResolvedValue(1),
      deleteAdmissionTimeRanges: vi.fn().mockResolvedValue(2),
      deleteAdmissionSettings: vi.fn().mockResolvedValue(1),
      deleteUserAdmissionAssignments: vi.fn().mockResolvedValue(1),
      deleteAdmissionCandidates: vi.fn().mockResolvedValue(2),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = admissionActionService(connection, repository, audit);

    await expect(
      service.deleteAdmission({ admissionName: "학생부교과", password: "1234" }, admin),
    ).resolves.toMatchObject({
      deleted: true,
      admissionName: "학생부교과",
      deletedCandidateCount: 2,
      deletedAssignmentCount: 2,
    });

    expect(repository.deleteAdmissionAssignments).toHaveBeenCalledBefore(repository.deleteAdmissionCandidates);
    expect(audit.record).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({ eventType: "ADMISSION_DELETED", actorUserId: 1 }),
    );
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it("rolls back without deleting data when the reset password is incorrect", async () => {
    const connection = transactionConnection();
    const repository = {
      findHistoryResetPasswordForUpdate: vi.fn().mockResolvedValue(await hashPassword("correct-password")),
      lockAdmissionCandidateIds: vi.fn(),
    };
    const audit = { record: vi.fn() };
    const service = admissionActionService(connection, repository, audit);

    await expect(
      service.deleteAdmission({ admissionName: "학생부교과", password: "wrong-password" }, admin),
    ).rejects.toThrow("초기화 비밀번호가 올바르지 않습니다.");

    expect(repository.lockAdmissionCandidateIds).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});

describe("PseudonymsService roster export", () => {
  const scope = {
    examName: "2026 실기",
    examDate: "2026-08-11",
    examTime: "09:00",
    periodName: "1교시",
    admissionName: "일반",
  };
  const user = { id: 2, loginId: "operator", role: "OPERATOR" as const, admissionNames: ["일반"] };
  const registeredRow = {
    pseudonymNumber: "10",
    examineeNo: "10001",
    name: "홍길동",
    unitName: "디자인",
    majorName: "시각디자인",
    assignedAt: "26.08.11. 09:01:00",
    printedAt: "-",
    attendance: "응시" as const,
    status: "진행" as const,
  };
  const waitingRow = {
    pseudonymNumber: "-",
    examineeNo: "10002",
    name: "김대기",
    unitName: "디자인",
    majorName: "산업디자인",
    assignedAt: "-",
    printedAt: "-",
    attendance: "-" as const,
    status: "대기" as const,
  };

  it("builds the workbook only from canonical rows requeried inside the authorized schedule", async () => {
    const execute = vi.fn().mockResolvedValue([[waitingRow, registeredRow], []]);
    const build = vi.fn().mockResolvedValue(Buffer.from("xlsx"));
    const service = new PseudonymsService({ execute } as unknown as Pool, new PseudonymsRepository(), {
      stream: build,
    } as unknown as PseudonymRosterExporter);

    await expect(
      service.buildOperationRosterExport(
        {
          ...scope,
          query: {
            filters: [{ field: "status", mode: "include", values: ["진행"] }],
            sort: { field: "pseudonymNumber", direction: "desc" },
          },
        },
        user,
      ),
    ).resolves.toEqual(Buffer.from("xlsx"));

    expect(String(execute.mock.calls[0]?.[0])).toContain("cr.exam_name = ?");
    expect(execute.mock.calls[0]?.[1]).toEqual([
      scope.examName,
      scope.examDate,
      scope.examTime,
      scope.periodName,
      scope.admissionName,
      "진행",
    ]);
    expect(build).toHaveBeenCalledWith([{ sequence: 1, ...registeredRow }], { labelPrintingEnabled: false });
  });

  it("rejects a canonical filtered result above the server-side row limit", async () => {
    const rows = Array.from({ length: 10_001 }, (_, index) => ({
      ...waitingRow,
      examineeNo: String(index + 1),
    }));
    const execute = vi.fn().mockResolvedValue([rows, []]);
    const build = vi.fn();
    const service = new PseudonymsService({ execute } as unknown as Pool, new PseudonymsRepository(), {
      build,
    } as unknown as PseudonymRosterExporter);

    await expect(service.buildOperationRosterExport({ ...scope, query: { filters: [] } }, user)).rejects.toThrow(
      "최대 10,000건",
    );
    expect(build).not.toHaveBeenCalled();
  });
});

describe("PseudonymsService mutation facade", () => {
  it("delegates settings, assignment and operation transitions to their use cases", async () => {
    const user = { id: 1, loginId: "admin", role: "ADMIN" as const, admissionNames: [] };
    const scope = operationScopeFixture();
    const assignmentInput = {
      examineeNo: "10001",
      mode: "MANUAL" as const,
      manualNumber: "1001",
      examDate: scope.examDate,
      examTime: scope.examTime,
      periodName: scope.periodName,
      admissionName: scope.admissionName,
    };
    const assignmentResult = { assignment: true };
    const settingInput = {
      expectedVersion: 1,
      examName: scope.examName,
      admissionName: scope.admissionName,
      rangeStart: 1,
      rangeEnd: 9999,
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
    const settingResult = { setting: true };
    const closedResult = { closed: true };
    const reopenedResult = { closed: false };
    const assignPseudonym = {
      execute: vi.fn().mockResolvedValue(assignmentResult),
    } as unknown as AssignPseudonymUseCase;
    const changeOperationStatus = {
      close: vi.fn().mockResolvedValue(closedResult),
      reopen: vi.fn().mockResolvedValue(reopenedResult),
    } as unknown as ChangePseudonymOperationStatusUseCase;
    const updatePseudonymSetting = {
      execute: vi.fn().mockResolvedValue(settingResult),
    } as unknown as UpdatePseudonymSettingUseCase;
    const service = new PseudonymsService(
      {} as Pool,
      new PseudonymsRepository(),
      new PseudonymRosterExporter(),
      assignPseudonym,
      changeOperationStatus,
      updatePseudonymSetting,
    );

    await expect(service.updateSetting(settingInput, user)).resolves.toBe(settingResult);
    await expect(service.assign(assignmentInput, user)).resolves.toBe(assignmentResult);
    await expect(service.closeOperation(scope, user)).resolves.toBe(closedResult);
    await expect(service.reopenOperation(scope, user)).resolves.toBe(reopenedResult);
    expect(updatePseudonymSetting.execute).toHaveBeenCalledWith(settingInput, user);
    expect(assignPseudonym.execute).toHaveBeenCalledWith(assignmentInput, user);
    expect(changeOperationStatus.close).toHaveBeenCalledWith(scope, user);
    expect(changeOperationStatus.reopen).toHaveBeenCalledWith(scope, user);
  });
});

describe("pseudonym P0 transaction invariants", () => {
  it("uses the shared profile and operation rows as serialization points before locking the candidate", async () => {
    const executed: string[] = [];
    const candidate = {
      id: 11,
      candidateRecordId: 101,
      examineeNo: "10001",
      name: "홍길동",
      examName: "2026 실기",
      preassignedNumber: null,
      examDate: "2026-08-11",
      examTime: "09:00",
      period: "1교시",
      admission: "일반",
      unit: "디자인",
      major: "기초",
      building: "예술관",
      room: "101호",
    };
    const connection = {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      release: () => undefined,
      execute: async (sql: string) => {
        executed.push(sql);
        if (
          sql.includes("INSERT INTO pseudonym_admission_lock") ||
          sql.includes("INSERT INTO pseudonym_operation_mutex")
        )
          return [{ affectedRows: 1 }, []];
        if (sql.includes("FROM candidate_record cr") && sql.includes("cr.examinee_no = ?")) return [[candidate], []];
        if (
          sql.includes("INSERT INTO pseudonym_admission_lock") ||
          sql.includes("INSERT INTO pseudonym_operation_mutex") ||
          sql.includes("INSERT IGNORE INTO pseudonym_operation")
        )
          return [{ affectedRows: 1 }, []];
        if (sql.includes("SELECT id, closed FROM pseudonym_operation")) return [[{ id: 3, closed: false }], []];
        if (sql.includes("FROM pseudonym_time_range")) return [[], []];
        if (sql.includes("FROM pseudonym_setting"))
          return [
            [
              {
                id: 9,
                examName: "2026 실기",
                admissionName: "일반",
                rangeStart: 1,
                rangeEnd: 9999,
                nextSequence: 1,
                assignmentMethod: "MATCHING",
                autoDrawEnabled: false,
                autoDrawDelaySeconds: 3,
                printPreassignedLabel: false,
                autoAssignAbsenteesOnClose: false,
                deleteAbsenteeInfoOnReopen: false,
                useCandidatePhotos: true,
                enableBulkDraw: false,
              },
            ],
            [],
          ];
        if (sql.includes("FROM system_profile")) return [[{ pseudonymNoUniqueness: "ADMISSION" }], []];
        if (sql.includes("FROM pseudonym_assignment WHERE candidate_record_id"))
          return [
            [
              {
                id: 21,
                pseudonymNumber: "1001",
                mode: "MANUAL",
                assignedAt: "2026-08-11T09:01:00.000Z",
              },
            ],
            [],
          ];
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    const pool = { getConnection: async () => connection } as unknown as Pool;
    const service = new PseudonymsService(pool);

    const result = await service.assign(
      {
        examineeNo: "10001",
        mode: "MANUAL",
        manualNumber: "1001",
        examDate: "2026-08-11",
        examTime: "09:00",
        periodName: "1교시",
        admissionName: "일반",
      },
      { id: 2, loginId: "operator", role: "OPERATOR", admissionNames: ["일반"] },
    );

    expect(result.alreadyAssigned).toBe(true);
    expect(executed[2]).toContain("pseudonym_admission_lock");
    expect(executed[3]).toContain("pseudonym_operation_mutex");
    executed.splice(2, 2);
    expect(executed).toHaveLength(8);
    expect(executed[0]).toContain("FROM system_profile");
    expect(executed[0]).toContain("LOCK IN SHARE MODE");
    expect(executed[1]).toContain("FROM candidate_record cr");
    expect(executed[1]).not.toContain("FOR UPDATE");
    expect(executed[2]).toContain("INSERT IGNORE INTO pseudonym_operation");
    expect(executed[3]).toContain("FROM pseudonym_operation");
    expect(executed[3]).toContain("FOR UPDATE");
    expect(executed[4]).toContain("FROM pseudonym_setting");
    expect(executed[5]).toContain("FROM pseudonym_time_range");
    expect(executed[5]).toContain("FOR UPDATE");
    expect(executed[6]).toContain("FROM candidate_record cr");
    expect(executed[6]).toContain("FOR UPDATE");
    expect(executed[7]).toContain("FROM pseudonym_assignment");
  });

  it("materializes an open operation before acquiring its row lock", async () => {
    const calls: string[] = [];
    const scope = {
      examName: "2026 실기",
      examDate: "2026-08-11",
      examTime: "09:00",
      periodName: "1교시",
      admissionName: "일반",
    };
    const operation = await ensureAndLockOperation(scope, {
      ensure: async (params) => {
        calls.push(`ensure:${params.join("/")}`);
      },
      lock: async (params) => {
        calls.push(`lock:${params.join("/")}`);
        return { id: 7, closed: false };
      },
    });

    expect(operation).toEqual({ id: 7, closed: false });
    expect(calls).toEqual([
      "ensure:2026 실기/2026-08-11/09:00/1교시/일반",
      "lock:2026 실기/2026-08-11/09:00/1교시/일반",
    ]);
  });

  it("fails safely when an operation cannot be read after materialization", async () => {
    await expect(
      ensureAndLockOperation(
        {
          examName: "2026 실기",
          examDate: "2026-08-11",
          examTime: "09:00",
          periodName: "1교시",
          admissionName: "일반",
        },
        { ensure: async () => undefined, lock: async () => undefined },
      ),
    ).rejects.toThrow("교시 운영 정보를 잠그지 못했습니다");
  });

  it("counts range capacity only from active examinees in the selected exam", async () => {
    let capacitySql = "";
    let capacityParams: unknown[] = [];
    const setting = settingFixture();
    const connection = {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      release: () => undefined,
      query: async (sql: string, params: unknown[]) => {
        capacitySql = sql;
        capacityParams = params;
        return [[], []];
      },
      execute: async (sql: string) => {
        if (sql.includes("SELECT id FROM pseudonym_setting")) return [[{ id: setting.id }], []];
        if (sql.includes("FROM pseudonym_setting")) return [[setting], []];
        if (sql.includes("FROM pseudonym_time_range")) return [[], []];
        if (sql.includes("FROM system_profile")) return [[{ pseudonymNoUniqueness: "ADMISSION" }], []];
        if (sql.includes("INSERT IGNORE INTO pseudonym_setting")) return [{ affectedRows: 0 }, []];
        if (sql.includes("UPDATE pseudonym_setting")) return [{ affectedRows: 1 }, []];
        if (sql.includes("INSERT INTO audit_log")) return [{ affectedRows: 1 }, []];
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    const pool = {
      getConnection: async () => connection,
      execute: async (sql: string) => {
        if (sql.includes("FROM pseudonym_setting")) return [[setting], []];
        if (sql.includes("FROM pseudonym_time_range")) return [[], []];
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    } as unknown as Pool;

    await new PseudonymsService(pool).updateSetting(
      {
        expectedVersion: 1,
        examName: "2026 실기",
        admissionName: "일반",
        rangeStart: 1,
        rangeEnd: 9999,
        assignmentMethod: "MATCHING",
        autoDrawEnabled: false,
        autoDrawDelaySeconds: 3,
        printPreassignedLabel: false,
        autoAssignAbsenteesOnClose: false,
        deleteAbsenteeInfoOnReopen: false,
        useCandidatePhotos: true,
        enableBulkDraw: false,
        ranges: [],
      },
      { id: 1, loginId: "admin", role: "ADMIN", admissionNames: [] },
    );

    expect(capacitySql).not.toContain("JOIN examinee");
    expect(capacitySql).toContain("cr.exam_name = ?");
    expect(capacitySql).toContain("cr.status = 'ACTIVE'");
    expect(capacityParams).toEqual(["2026 실기", "일반"]);
  });

  it("keeps close assignment and status queries inside the selected exam", async () => {
    const scope = operationScopeFixture();
    const setting = settingFixture({ autoAssignAbsenteesOnClose: true });
    let candidateSql = "";
    let candidateParams: unknown[] = [];
    let countSql = "";
    let countParams: unknown[] = [];
    const connection = {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      release: () => undefined,
      execute: async (sql: string, params: unknown[] = []) => {
        if (
          sql.includes("INSERT INTO pseudonym_admission_lock") ||
          sql.includes("INSERT INTO pseudonym_operation_mutex") ||
          sql.includes("INSERT IGNORE INTO pseudonym_operation")
        )
          return [{ affectedRows: 1 }, []];
        if (sql.includes("SELECT id, closed FROM pseudonym_operation")) return [[{ id: 7, closed: false }], []];
        if (sql.includes("FROM pseudonym_setting")) return [[setting], []];
        if (sql.includes("FROM pseudonym_time_range")) return [[], []];
        if (sql.includes("FROM system_profile")) return [[{ pseudonymNoUniqueness: "ADMISSION" }], []];
        if (sql.includes("SELECT pseudonym_no AS pseudonymNumber")) return [[], []];
        if (sql.includes("cr.temporary_no AS pseudonymNumber")) return [[], []];
        if (sql.includes("FROM candidate_record cr")) {
          candidateSql = sql;
          candidateParams = params;
          return [[], []];
        }
        if (sql.includes("UPDATE pseudonym_operation") || sql.includes("INSERT INTO audit_log"))
          return [{ affectedRows: 1 }, []];
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    const pool = {
      getConnection: async () => connection,
      execute: async (sql: string, params: unknown[] = []) => {
        if (sql.includes("FROM pseudonym_operation po"))
          return [[{ closed: true, closedAt: null, closedByLoginId: "admin" }], []];
        if (sql.includes("COUNT(*) AS autoAssignedAbsenteeCount")) {
          countSql = sql;
          countParams = params;
          return [[{ autoAssignedAbsenteeCount: 0 }], []];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    } as unknown as Pool;

    await new PseudonymsService(pool).closeOperation(scope, {
      id: 1,
      loginId: "admin",
      role: "ADMIN",
      admissionNames: [],
    });

    expect(candidateSql).toContain("cr.exam_name = ?");
    expect(candidateParams).toEqual(["2026 실기", "2026-08-11", "09:00", "1교시", "일반"]);
    expect(countSql).toContain("pa.exam_name = ? AND pa.admission_name = ?");
    expect(countParams).toEqual(["2026 실기", "일반", "2026-08-11", "09:00", "1교시", "일반"]);
  });

  it("deletes only auto-assigned absentees from the selected exam when reopening", async () => {
    const scope = operationScopeFixture();
    const setting = settingFixture({ deleteAbsenteeInfoOnReopen: true });
    let deleteSql = "";
    let deleteParams: unknown[] = [];
    const connection = {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      release: () => undefined,
      execute: async (sql: string, params: unknown[] = []) => {
        if (sql.includes("FROM system_profile")) return [[{ pseudonymNoUniqueness: "ADMISSION" }], []];
        if (sql.includes("SELECT id, closed FROM pseudonym_operation")) return [[{ id: 7, closed: true }], []];
        if (sql.includes("FROM pseudonym_setting")) return [[setting], []];
        if (sql.includes("DELETE pa FROM pseudonym_assignment")) {
          deleteSql = sql;
          deleteParams = params;
          return [{ affectedRows: 0 }, []];
        }
        if (sql.includes("UPDATE pseudonym_operation") || sql.includes("INSERT INTO audit_log"))
          return [{ affectedRows: 1 }, []];
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    const pool = {
      getConnection: async () => connection,
      execute: async (sql: string) => {
        if (sql.includes("FROM pseudonym_operation po"))
          return [[{ closed: false, closedAt: null, closedByLoginId: null }], []];
        if (sql.includes("COUNT(*) AS autoAssignedAbsenteeCount")) return [[{ autoAssignedAbsenteeCount: 0 }], []];
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    } as unknown as Pool;

    await new PseudonymsService(pool).reopenOperation(scope, {
      id: 1,
      loginId: "admin",
      role: "ADMIN",
      admissionNames: [],
    });

    expect(deleteSql).toContain("pa.exam_name = ? AND pa.admission_name = ?");
    expect(deleteParams).toEqual(["2026 실기", "일반", "2026-08-11", "09:00", "1교시", "일반"]);
  });
});

function settingFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    version: 1,
    examName: "2026 실기",
    admissionName: "일반",
    rangeStart: 1,
    rangeEnd: 9999,
    nextSequence: 1,
    assignmentMethod: "MATCHING",
    autoDrawEnabled: false,
    autoDrawDelaySeconds: 3,
    printPreassignedLabel: false,
    autoAssignAbsenteesOnClose: false,
    deleteAbsenteeInfoOnReopen: false,
    useCandidatePhotos: true,
    enableBulkDraw: false,
    ...overrides,
  };
}

function operationScopeFixture() {
  return {
    examName: "2026 실기",
    examDate: "2026-08-11",
    examTime: "09:00",
    periodName: "1교시",
    admissionName: "일반",
  };
}

function overviewRange(settingId: number, admission: string, rangeStart: number) {
  return {
    settingId,
    id: settingId * 10,
    date: "2026-08-11",
    time: "09:00",
    period: "1교시",
    admission,
    unit: "",
    major: "",
    building: "본관",
    room: "101호",
    scheduleKey: `${settingId}-${admission}`,
    rangeStart,
    rangeEnd: rangeStart + 9,
    nextSequence: rangeStart,
  };
}

function transactionConnection() {
  return {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  };
}

function admissionActionService(
  connection: ReturnType<typeof transactionConnection>,
  repository: Record<string, unknown>,
  audit: Record<string, unknown>,
) {
  return new PseudonymsService(
    { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool,
    repository as unknown as PseudonymsRepository,
    new PseudonymRosterExporter(),
    {} as AssignPseudonymUseCase,
    {} as ChangePseudonymOperationStatusUseCase,
    {} as UpdatePseudonymSettingUseCase,
    audit as unknown as MutationAuditRepository,
  );
}

vi.mock("../common/database/transaction.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../common/database/transaction.js")>()),
  beginScopedWrite: async (connection: { beginTransaction(): Promise<void> }) => connection.beginTransaction(),
}));
