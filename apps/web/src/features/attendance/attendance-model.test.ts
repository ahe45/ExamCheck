import { describe, expect, it } from "vitest";
import type { CandidateAttendanceRecord } from "../../shared/api/candidates";
import { attendanceViews } from "../../shared/navigation/admin-navigation";
import { attendanceTotals, attendanceValue, buildAttendanceRows } from "./attendance-model";

export function attendanceRecord(
  id: number,
  overrides: Partial<CandidateAttendanceRecord> = {},
): CandidateAttendanceRecord {
  return {
    id,
    admission: "일반",
    unit: "음악",
    major: "피아노",
    group: "1조",
    date: "2026-10-21",
    time: "09:00",
    period: "1교시",
    building: "본관",
    room: "101",
    waitingRoom: "201",
    examineeNo: String(id),
    name: `수험생${id}`,
    attendance: "대기",
    ...overrides,
  };
}

describe("attendance aggregation", () => {
  const records = [
    attendanceRecord(1, { attendance: "응시" }),
    attendanceRecord(2, { attendance: "결시" }),
    attendanceRecord(3),
  ];
  it.each(attendanceViews)("preserves head counts in $label", ({ key }) => {
    const total = attendanceTotals(buildAttendanceRows(records, key));
    expect(total).toMatchObject({ total: 3, present: 1, absent: 1 });
    expect(attendanceValue(total, "presentRate")).toBe("33.3%");
  });
  it("keeps same-name units and rooms in separate parent scopes", () => {
    expect(buildAttendanceRows([records[0], attendanceRecord(2, { admission: "특별" })], "unit")).toHaveLength(2);
    expect(buildAttendanceRows([records[0], attendanceRecord(2, { building: "별관" })], "room")).toHaveLength(2);
    expect(buildAttendanceRows([records[0], attendanceRecord(2, { date: "2026-10-22" })], "group")).toHaveLength(2);
  });
  it("computes weighted rates from filtered group totals and handles empty results", () => {
    const rows = [
      { id: "a", values: {}, total: 90, present: 90, absent: 0 },
      { id: "b", values: {}, total: 10, present: 0, absent: 10 },
    ];
    expect(attendanceValue(attendanceTotals(rows), "presentRate")).toBe("90.0%");
    expect(attendanceValue(attendanceTotals(rows.slice(1)), "absentRate")).toBe("100.0%");
    expect(attendanceValue(attendanceTotals([]), "presentRate")).toBe("0.0%");
  });
});
