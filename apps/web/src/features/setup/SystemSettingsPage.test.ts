import { describe, expect, it } from "vitest";
import type { CandidateRecord } from "../../shared/api/candidates";
import type { PseudonymSetting } from "../../shared/api/pseudonyms";
import {
  applyBulkRangeSettings,
  buildScheduleRanges,
  configuredRangeBounds,
  createSettingsSnapshot,
  formatRangeNumber,
  hasInvalidRange,
  toSettingRanges,
  updateRangeStart,
} from "./system-settings-domain";

const setting: PseudonymSetting = {
  id: 1,
  version: 1,
  examName: "2026년도 자격시험",
  admissionName: "학생부교과 면접",
  rangeStart: 1001,
  rangeEnd: 1999,
  nextSequence: 1001,
  assignmentMethod: "DRAW",
  autoDrawEnabled: false,
  autoDrawDelaySeconds: 3,
  printPreassignedLabel: true,
  autoAssignAbsenteesOnClose: false,
  deleteAbsenteeInfoOnReopen: false,
  useCandidatePhotos: true,
  enableBulkDraw: false,
  ranges: [
    {
      date: "2026-08-11",
      time: "09:00",
      period: "1교시",
      admission: "일반",
      unit: "디자인학부",
      major: "기초디자인",
      building: "예술관",
      room: "101호",
      rangeStart: 2001,
      rangeEnd: 2099,
      nextSequence: 2001,
    },
  ],
};

describe("system setting schedule ranges", () => {
  it("groups candidates by date and time and restores saved ranges", () => {
    const candidates = [
      {
        date: "2026-08-11",
        time: "09:00",
        period: "1교시",
        admission: "일반",
        unit: "디자인학부",
        major: "기초디자인",
        building: "예술관",
        room: "101호",
      },
      {
        date: "2026-08-11",
        time: "09:00",
        period: "1교시",
        admission: "일반",
        unit: "디자인학부",
        major: "기초디자인",
        building: "예술관",
        room: "101호",
      },
      {
        date: "2026-08-11",
        time: "13:00",
        period: "2교시",
        admission: "특별",
        unit: "체육학부",
        major: "체육실기",
        building: "체육관",
        room: "주경기장",
      },
    ] as CandidateRecord[];

    expect(buildScheduleRanges(candidates, setting)).toEqual([
      {
        date: "2026-08-11",
        time: "09:00",
        period: "1교시",
        admission: "일반",
        unit: "디자인학부",
        major: "기초디자인",
        building: "예술관",
        room: "101호",
        candidateCount: 2,
        rangeStart: 2001,
        rangeEnd: 2002,
      },
      {
        date: "2026-08-11",
        time: "13:00",
        period: "2교시",
        admission: "특별",
        unit: "체육학부",
        major: "체육실기",
        building: "체육관",
        room: "주경기장",
        candidateCount: 1,
        rangeStart: 1001,
        rangeEnd: 1001,
      },
    ]);
  });

  it("creates continuous ranges using each schedule's candidate count", () => {
    const ranges = [
      {
        date: "2026-08-11",
        time: "09:00",
        period: "1교시",
        admission: "일반",
        unit: "A",
        major: "",
        building: "본관",
        room: "101호",
        candidateCount: 3,
        rangeStart: 1,
        rangeEnd: 3,
      },
      {
        date: "2026-08-11",
        time: "13:00",
        period: "2교시",
        admission: "일반",
        unit: "A",
        major: "",
        building: "본관",
        room: "101호",
        candidateCount: 2,
        rangeStart: 1,
        rangeEnd: 2,
      },
    ];
    expect(applyBulkRangeSettings(ranges, 1001, "CONTINUOUS")).toEqual([
      { ...ranges[0], rangeStart: 1001, rangeEnd: 1003 },
      { ...ranges[1], rangeStart: 1004, rangeEnd: 1005 },
    ]);
  });

  it("can apply the same start number while preserving exact capacities", () => {
    const ranges = [
      {
        date: "2026-08-11",
        time: "09:00",
        period: "1교시",
        admission: "일반",
        unit: "A",
        major: "",
        building: "본관",
        room: "101호",
        candidateCount: 3,
        rangeStart: 1,
        rangeEnd: 3,
      },
      {
        date: "2026-08-11",
        time: "13:00",
        period: "2교시",
        admission: "일반",
        unit: "A",
        major: "",
        building: "본관",
        room: "101호",
        candidateCount: 2,
        rangeStart: 1,
        rangeEnd: 2,
      },
    ];
    const result = applyBulkRangeSettings(ranges, 2001, "SAME_START");
    expect(result.map(({ rangeStart, rangeEnd }) => ({ rangeStart, rangeEnd }))).toEqual([
      { rangeStart: 2001, rangeEnd: 2003 },
      { rangeStart: 2001, rangeEnd: 2002 },
    ]);
  });

  it("assigns continuous ranges by the selected criteria priority without changing grid order", () => {
    const ranges = [
      {
        date: "2026-08-12",
        time: "09:00",
        period: "1교시",
        admission: "일반",
        unit: "B",
        major: "",
        building: "본관",
        room: "102호",
        candidateCount: 2,
        rangeStart: 1,
        rangeEnd: 2,
      },
      {
        date: "2026-08-11",
        time: "13:00",
        period: "2교시",
        admission: "일반",
        unit: "A",
        major: "",
        building: "본관",
        room: "101호",
        candidateCount: 3,
        rangeStart: 1,
        rangeEnd: 3,
      },
      {
        date: "2026-08-11",
        time: "09:00",
        period: "1교시",
        admission: "일반",
        unit: "B",
        major: "",
        building: "본관",
        room: "103호",
        candidateCount: 1,
        rangeStart: 1,
        rangeEnd: 1,
      },
    ];

    const result = applyBulkRangeSettings(ranges, 1001, "CONTINUOUS", ["unit", "date"]);

    expect(result.map(({ rangeStart, rangeEnd }) => ({ rangeStart, rangeEnd }))).toEqual([
      { rangeStart: 1005, rangeEnd: 1006 },
      { rangeStart: 1001, rangeEnd: 1003 },
      { rangeStart: 1004, rangeEnd: 1004 },
    ]);
    expect(result.map(({ date, room }) => ({ date, room }))).toEqual(ranges.map(({ date, room }) => ({ date, room })));
  });

  it("forces the end number to the registered candidate count when a start number changes", () => {
    const ranges = [
      {
        date: "2026-08-11",
        time: "09:00",
        period: "1교시",
        admission: "일반",
        unit: "A",
        major: "",
        building: "본관",
        room: "101호",
        candidateCount: 3,
        rangeStart: 1001,
        rangeEnd: 1003,
      },
      {
        date: "2026-08-11",
        time: "13:00",
        period: "2교시",
        admission: "일반",
        unit: "A",
        major: "",
        building: "본관",
        room: "102호",
        candidateCount: 2,
        rangeStart: 2001,
        rangeEnd: 2002,
      },
    ];

    const result = updateRangeStart(ranges, 0, 3001);

    expect(result[0]).toEqual({ ...ranges[0], rangeStart: 3001, rangeEnd: 3003 });
    expect(result[1]).toBe(ranges[1]);
    expect(ranges[0]).toEqual(expect.objectContaining({ rangeStart: 1001, rangeEnd: 1003 }));
  });

  it("keeps the start number width when calculating the end number", () => {
    const range = {
      date: "2026-08-11",
      time: "09:00",
      period: "1교시",
      admission: "일반",
      unit: "A",
      major: "",
      building: "본관",
      room: "101호",
      candidateCount: 30,
      rangeStart: 1,
      rangeEnd: 30,
    };

    const [result] = updateRangeStart([range], 0, 1, 4);

    expect(formatRangeNumber(result!.rangeStart, result!.displayWidth)).toBe("0001");
    expect(formatRangeNumber(result!.rangeEnd, result!.displayWidth)).toBe("0030");
  });

  it("rejects a non-positive start or a range whose capacity differs from the candidate count", () => {
    const valid = {
      date: "2026-08-11",
      time: "09:00",
      period: "1교시",
      admission: "일반",
      unit: "A",
      major: "",
      building: "본관",
      room: "101호",
      candidateCount: 3,
      rangeStart: 1001,
      rangeEnd: 1003,
    };

    expect(hasInvalidRange([valid])).toBe(false);
    expect(hasInvalidRange([{ ...valid, rangeStart: 0, rangeEnd: 2 }])).toBe(true);
    expect(hasInvalidRange([{ ...valid, rangeEnd: 1004 }])).toBe(true);
  });

  it("derives API bounds and strips UI-only candidate counts from range payloads", () => {
    const ranges = [
      {
        date: "2026-08-11",
        time: "09:00",
        period: "1교시",
        admission: "일반",
        unit: "A",
        major: "",
        building: "본관",
        room: "101호",
        candidateCount: 3,
        rangeStart: 2001,
        rangeEnd: 2003,
      },
      {
        date: "2026-08-11",
        time: "13:00",
        period: "2교시",
        admission: "일반",
        unit: "A",
        major: "",
        building: "본관",
        room: "102호",
        candidateCount: 2,
        rangeStart: 1001,
        rangeEnd: 1002,
      },
    ];

    expect(configuredRangeBounds(ranges, { start: 1, end: 9 })).toEqual({ rangeStart: 1001, rangeEnd: 2003 });
    expect(configuredRangeBounds([], { start: 11, end: 19 })).toEqual({ rangeStart: 11, rangeEnd: 19 });
    expect(toSettingRanges(ranges)[0]).not.toHaveProperty("candidateCount");
  });

  it("does not mark candidate-count-only changes as persisted setting changes", () => {
    const range = {
      date: "2026-08-11",
      time: "09:00",
      period: "1교시",
      admission: "일반",
      unit: "A",
      major: "",
      building: "본관",
      room: "101호",
      candidateCount: 3,
      rangeStart: 1001,
      rangeEnd: 1003,
    };
    const base = {
      assignmentMethod: "DRAW" as const,
      ranges: [range],
      autoDrawEnabled: false,
      autoDrawDelaySeconds: 3,
      printPreassignedLabel: false,
      autoAssignAbsenteesOnClose: false,
      deleteAbsenteeInfoOnReopen: false,
      useCandidatePhotos: true,
      enableBulkDraw: false,
    };

    expect(createSettingsSnapshot(base)).toBe(
      createSettingsSnapshot({ ...base, ranges: [{ ...range, candidateCount: 99 }] }),
    );
  });
});
