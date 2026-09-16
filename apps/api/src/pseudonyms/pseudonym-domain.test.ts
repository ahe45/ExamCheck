import { describe, expect, it } from "vitest";
import {
  assignmentModeForSetting,
  assignmentResponse,
  assertAssignmentMethod,
  assertCandidateScopeStable,
  assertExistingAssignmentsWithinProposedRanges,
  assertExpectedSettingVersion,
  assertScheduleRangeCapacities,
  assertWithinRange,
  candidatePseudonymScope,
  chooseRandomAvailable,
  chooseSequentialAvailable,
  hasRangeConfigurationChanged,
  operationPseudonymScope,
  operationStatusResponse,
  parsePseudonym,
  preserveNextSequence,
  scheduleIdentity,
  scheduleKey,
  settingResponse,
} from "./pseudonym-domain.js";

const schedule = {
  date: "2026-08-11",
  time: "09:00",
  period: "1교시",
  admission: "일반",
  unit: "디자인",
  major: "기초",
  building: "예술관",
  room: "101호",
};

const candidate = {
  id: 1,
  candidateRecordId: 11,
  examineeNo: "10001",
  examName: "2026 실기",
  examDate: schedule.date,
  examTime: schedule.time,
  period: schedule.period,
  admission: schedule.admission,
  unit: schedule.unit,
  major: schedule.major,
  building: schedule.building,
  room: schedule.room,
};

const proposedSequential = {
  assignmentMethod: "SEQUENTIAL" as const,
  rangeStart: 1,
  rangeEnd: 999999,
  ranges: [{ ...schedule, rangeStart: 1001, rangeEnd: 1003 }],
};

describe("pseudonym setting rules", () => {
  it("accepts only the current optimistic version, including a new setting at version zero", () => {
    expect(() => assertExpectedSettingVersion(5, 5, false)).not.toThrow();
    expect(() => assertExpectedSettingVersion(0, 99, true)).not.toThrow();
    expect(() => assertExpectedSettingVersion(4, 5, false)).toThrow("최신 설정을 다시 불러온 뒤 다시 시도해 주세요");
    expect(() => assertExpectedSettingVersion(1, 1, true)).toThrow("최신 설정을 다시 불러온 뒤 다시 시도해 주세요");
  });

  it.each([
    ["DRAW", "RANDOM"],
    ["SEQUENTIAL", "SEQUENTIAL"],
    ["MATCHING", "MANUAL"],
    ["PREASSIGNED", "PREASSIGNED"],
  ] as const)("maps %s settings to %s assignment mode", (method, mode) => {
    expect(assignmentModeForSetting(method)).toBe(mode);
    expect(() => assertAssignmentMethod(mode, method)).not.toThrow();
  });

  it.each([
    ["DRAW", "SEQUENTIAL"],
    ["SEQUENTIAL", "RANDOM"],
    ["MATCHING", "PREASSIGNED"],
    ["PREASSIGNED", "MANUAL"],
  ] as const)("rejects %s settings with %s assignment mode", (method, mode) => {
    expect(() => assertAssignmentMethod(mode, method)).toThrow("선택한 가번호 부여 방식");
  });

  it("preserves a cursor at both boundaries and resets missing or out-of-range cursors", () => {
    expect(preserveNextSequence(1001, 1001, 1005)).toBe(1001);
    expect(preserveNextSequence(1005, 1001, 1005)).toBe(1005);
    expect(preserveNextSequence(1000, 1001, 1005)).toBe(1001);
    expect(preserveNextSequence(1006, 1001, 1005)).toBe(1001);
    expect(preserveNextSequence(undefined, 1001, 1005)).toBe(1001);
  });

  it("detects every setting or schedule-range change without changing the schedule hash contract", () => {
    const key = scheduleKey(schedule);
    expect(scheduleIdentity(schedule)).toBe("2026-08-11|09:00|1교시|일반|디자인|기초|예술관|101호");
    expect(key).toBe("8215fbfbe1f5cce88336d5581f74088c45804663c692cec98fc11377496dc4af");

    const existingSetting = { assignmentMethod: "SEQUENTIAL" as const, rangeStart: 1, rangeEnd: 999999 };
    const existingRanges = [{ id: 3, scheduleKey: key, rangeStart: 1001, rangeEnd: 1003, nextSequence: 1002 }];
    expect(hasRangeConfigurationChanged(existingSetting, existingRanges, proposedSequential)).toBe(false);
    expect(hasRangeConfigurationChanged(undefined, existingRanges, proposedSequential)).toBe(true);
    expect(
      hasRangeConfigurationChanged(
        { ...existingSetting, assignmentMethod: "DRAW" },
        existingRanges,
        proposedSequential,
      ),
    ).toBe(true);
    expect(
      hasRangeConfigurationChanged({ ...existingSetting, rangeStart: 2 }, existingRanges, proposedSequential),
    ).toBe(true);
    expect(
      hasRangeConfigurationChanged({ ...existingSetting, rangeEnd: 999998 }, existingRanges, proposedSequential),
    ).toBe(true);
    expect(hasRangeConfigurationChanged(existingSetting, [], proposedSequential)).toBe(true);
    expect(
      hasRangeConfigurationChanged(existingSetting, existingRanges, {
        ...proposedSequential,
        ranges: [{ ...proposedSequential.ranges[0], room: "102호" }],
      }),
    ).toBe(true);
    expect(
      hasRangeConfigurationChanged(existingSetting, existingRanges, {
        ...proposedSequential,
        ranges: [{ ...proposedSequential.ranges[0], rangeEnd: 1004 }],
      }),
    ).toBe(true);
  });
});

describe("pseudonym number selection and validation", () => {
  it("selects the only random number that is not reserved", () => {
    expect(chooseRandomAvailable(2001, 2003, new Set([2001, 2003]))).toBe(2002);
  });

  it("rejects invalid or fully occupied random ranges with the original domain errors", () => {
    expect(() => chooseRandomAvailable(2, 1, new Set())).toThrow("가번호 범위 설정이 올바르지 않습니다");
    expect(() => chooseRandomAvailable(1, 2, new Set([1, 2]))).toThrow("부여 가능한 가번호가 없습니다");
  });

  it("selects sequentially, wraps, and normalizes cursors outside the range", () => {
    expect(chooseSequentialAvailable(1001, 1001, 1005, new Set([1001, 1002, 1004]))).toBe(1003);
    expect(chooseSequentialAvailable(1005, 1001, 1005, new Set([1005, 1001]))).toBe(1002);
    expect(chooseSequentialAvailable(999, 1001, 1005, new Set([1001]))).toBe(1002);
    expect(chooseSequentialAvailable(9999, 1001, 1005, new Set())).toBe(1001);
  });

  it("rejects invalid or fully occupied sequential ranges", () => {
    expect(() => chooseSequentialAvailable(1, 2, 1, new Set())).toThrow("가번호 범위 설정이 올바르지 않습니다");
    expect(() => chooseSequentialAvailable(1, 1, 2, new Set([1, 2]))).toThrow("부여 가능한 가번호가 없습니다");
  });

  it("accepts inclusive range boundaries and rejects values outside them", () => {
    expect(() => assertWithinRange(1001, { rangeStart: 1001, rangeEnd: 1003 })).not.toThrow();
    expect(() => assertWithinRange(1003, { rangeStart: 1001, rangeEnd: 1003 })).not.toThrow();
    expect(() => assertWithinRange(1000, { rangeStart: 1001, rangeEnd: 1003 })).toThrow("1001부터 1003 사이");
    expect(() => assertWithinRange(1004, { rangeStart: 1001, rangeEnd: 1003 })).toThrow("1001부터 1003 사이");
  });

  it("parses digit-only positive safe integers without changing leading-zero behavior", () => {
    expect(parsePseudonym("0012")).toBe(12);
    expect(parsePseudonym(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => parsePseudonym(" 12")).toThrow("가번호는 숫자로 입력");
    expect(() => parsePseudonym("12A")).toThrow("가번호는 숫자로 입력");
    expect(() => parsePseudonym("0")).toThrow("가번호 형식이 올바르지 않습니다");
    expect(() => parsePseudonym("9007199254740992")).toThrow("가번호 형식이 올바르지 않습니다");
  });
});

describe("pseudonym schedule range rules", () => {
  it("requires every schedule range and exact candidate capacity when the method uses ranges", () => {
    const schedules = [{ ...schedule, candidateCount: 3 }];
    expect(() => assertScheduleRangeCapacities([], schedules, true)).toThrow("모든 시험 조건");
    expect(() =>
      assertScheduleRangeCapacities(
        [{ ...schedule, room: "없는 고사실", rangeStart: 1001, rangeEnd: 1003 }],
        schedules,
        false,
      ),
    ).toThrow("등록된 수험생 데이터가 없습니다");
    expect(() =>
      assertScheduleRangeCapacities([{ ...schedule, rangeStart: 1001, rangeEnd: 1002 }], schedules, true),
    ).toThrow("등록 수험생 3명과 동일한 3개");
    expect(() =>
      assertScheduleRangeCapacities([{ ...schedule, rangeStart: 1001, rangeEnd: 1003 }], schedules, true),
    ).not.toThrow();
    expect(() => assertScheduleRangeCapacities([], schedules, false)).not.toThrow();
  });

  it("keeps existing global-range assignments only when they remain inclusive", () => {
    const assignment = { assignmentId: 5, examineeNo: "10001", pseudonymNumber: "1001", ...schedule };
    const matching = { assignmentMethod: "PREASSIGNED" as const, rangeStart: 1001, rangeEnd: 1003, ranges: [] };
    expect(() => assertExistingAssignmentsWithinProposedRanges([assignment], matching)).not.toThrow();
    expect(() =>
      assertExistingAssignmentsWithinProposedRanges([{ ...assignment, pseudonymNumber: "1003" }], matching),
    ).not.toThrow();
    expect(() =>
      assertExistingAssignmentsWithinProposedRanges([{ ...assignment, pseudonymNumber: "1000" }], matching),
    ).toThrow("기존 가번호 1000가 변경할 범위에 포함되지 않습니다");
  });

  it("rejects invalid legacy numbers and incomplete or mismatched schedule assignments", () => {
    const assignment = { assignmentId: 5, examineeNo: "10001", pseudonymNumber: "1002", ...schedule };
    expect(() => assertExistingAssignmentsWithinProposedRanges([assignment], proposedSequential)).not.toThrow();
    expect(() =>
      assertExistingAssignmentsWithinProposedRanges([{ ...assignment, pseudonymNumber: "A1002" }], proposedSequential),
    ).toThrow("기존 가번호 A1002가 변경할 범위에 포함되지 않습니다");
    expect(() =>
      assertExistingAssignmentsWithinProposedRanges([{ ...assignment, pseudonymNumber: "0" }], proposedSequential),
    ).toThrow("기존 가번호 0가 변경할 범위에 포함되지 않습니다");
    expect(() =>
      assertExistingAssignmentsWithinProposedRanges(
        [{ ...assignment, pseudonymNumber: "9007199254740992" }],
        proposedSequential,
      ),
    ).toThrow("기존 가번호 9007199254740992가 변경할 범위에 포함되지 않습니다");
    expect(() =>
      assertExistingAssignmentsWithinProposedRanges([{ ...assignment, room: null }], proposedSequential),
    ).toThrow("기존 가번호 1002가 변경할 범위에 포함되지 않습니다");
    expect(() =>
      assertExistingAssignmentsWithinProposedRanges([{ ...assignment, room: "102호" }], proposedSequential),
    ).toThrow("기존 가번호 1002가 변경할 범위에 포함되지 않습니다");
    expect(() =>
      assertExistingAssignmentsWithinProposedRanges([{ ...assignment, pseudonymNumber: "1004" }], proposedSequential),
    ).toThrow("기존 가번호 1004가 변경할 범위에 포함되지 않습니다");
  });
});

describe("pseudonym candidate and response mappings", () => {
  it("detects a missing candidate or any identity change after the operation lock", () => {
    expect(() => assertCandidateScopeStable(candidate, { ...candidate })).not.toThrow();
    expect(() => assertCandidateScopeStable(candidate, { ...candidate, room: "102호" })).toThrow(
      "전형·교시 정보가 변경",
    );
    expect(() => assertCandidateScopeStable({ ...candidate, room: null }, { ...candidate, room: "" })).toThrow(
      "전형·교시 정보가 변경",
    );
    expect(() => assertCandidateScopeStable(candidate, undefined)).toThrow("전형·교시 정보가 변경");
  });

  it("maps operation and valid candidate scopes while rejecting an incomplete candidate scope", () => {
    expect(
      operationPseudonymScope({
        examName: "2026 실기",
        examDate: schedule.date,
        examTime: schedule.time,
        periodName: schedule.period,
        admissionName: schedule.admission,
      }),
    ).toEqual({ date: schedule.date, time: schedule.time, period: schedule.period, admission: schedule.admission });
    expect(candidatePseudonymScope(candidate)).toEqual({
      date: schedule.date,
      time: schedule.time,
      period: schedule.period,
      admission: schedule.admission,
    });
    expect(() => candidatePseudonymScope({ ...candidate, period: null })).toThrow("전형·교시 정보가 올바르지 않습니다");
  });

  it("normalizes operation status values without changing count or timestamp data", () => {
    expect(operationStatusResponse(undefined, 0)).toEqual({
      closed: false,
      closedAt: null,
      closedByLoginId: null,
      autoAssignedAbsenteeCount: 0,
    });
    const closedAt = new Date("2026-08-11T09:00:00.000Z");
    expect(operationStatusResponse({ closed: 1, closedAt, closedByLoginId: "admin" }, 3)).toEqual({
      closed: true,
      closedAt,
      closedByLoginId: "admin",
      autoAssignedAbsenteeCount: 3,
    });
  });

  it("preserves setting response compatibility for inherited and admission-specific settings", () => {
    const setting = settingFixture();
    const range = {
      id: 2,
      scheduleKey: scheduleKey(schedule),
      ...schedule,
      rangeStart: 1001,
      rangeEnd: 1003,
      nextSequence: 1002,
    };
    const exact = settingResponse(setting, [range]);
    expect(exact).toMatchObject({
      version: 7,
      admissionName: "일반",
      autoDrawEnabled: true,
      printPreassignedLabel: false,
      ranges: [{ ...schedule, rangeStart: 1001, rangeEnd: 1003, nextSequence: 1002 }],
    });
    expect(settingResponse({ ...setting, admissionName: "" }, [range], "일반").version).toBe(0);
  });

  it("maps an assignment without altering its number, mode, timestamp, or already-assigned flag", () => {
    const assignedAt = new Date("2026-08-11T09:00:00.000Z");
    expect(
      assignmentResponse(
        { ...candidate, name: "홍길동" },
        {
          id: 3,
          pseudonymNumber: "0012",
          mode: "MANUAL",
          assignedAt,
        },
        true,
      ),
    ).toEqual({
      id: 3,
      examineeNo: "10001",
      examineeName: "홍길동",
      examName: "2026 실기",
      pseudonymNumber: "0012",
      mode: "MANUAL",
      assignedAt,
      alreadyAssigned: true,
    });
  });
});

function settingFixture() {
  return {
    id: 9,
    version: 7,
    examName: "2026 실기",
    admissionName: "일반",
    rangeStart: 1,
    rangeEnd: 9999,
    nextSequence: 12,
    assignmentMethod: "DRAW" as const,
    autoDrawEnabled: 1,
    autoDrawDelaySeconds: 3,
    printPreassignedLabel: 0,
    autoAssignAbsenteesOnClose: true,
    deleteAbsenteeInfoOnReopen: false,
    useCandidatePhotos: 1,
    enableBulkDraw: 0,
  };
}
