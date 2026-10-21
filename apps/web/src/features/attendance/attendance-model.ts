import type { CandidateAttendanceRecord } from "../../shared/api/candidates";
import type { AttendanceView } from "../../shared/navigation/admin-navigation";

export type AttendanceField = Exclude<keyof CandidateAttendanceRecord, "id">;
export type AttendanceColumn = AttendanceField | "total" | "present" | "absent" | "presentRate" | "absentRate";
export interface AttendanceGridRow {
  id: string;
  values: Partial<Record<AttendanceField, string>>;
  total: number;
  present: number;
  absent: number;
}

export const attendanceLabels: Record<AttendanceColumn, string> = {
  admission: "전형",
  unit: "모집단위",
  major: "전공",
  group: "조",
  date: "날짜",
  time: "시간",
  period: "교시",
  building: "건물",
  room: "고사실",
  waitingRoom: "대기실",
  examineeNo: "수험번호",
  name: "성명",
  attendance: "응시 여부",
  total: "전체인원",
  present: "응시인원",
  absent: "결시인원",
  presentRate: "응시율",
  absentRate: "결시율",
};

export const attendanceDimensions: Record<AttendanceView, AttendanceField[]> = {
  admission: ["admission"],
  unit: ["admission", "unit"],
  major: ["admission", "unit", "major"],
  group: ["admission", "unit", "major", "date", "time", "period", "group"],
  date: ["date"],
  period: ["date", "time", "period"],
  building: ["building"],
  room: ["building", "room"],
  waitingRoom: ["building", "waitingRoom"],
  candidate: [
    "examineeNo",
    "name",
    "admission",
    "unit",
    "major",
    "group",
    "date",
    "time",
    "period",
    "building",
    "room",
    "waitingRoom",
    "attendance",
  ],
};
export const attendanceMetrics = ["total", "present", "absent", "presentRate", "absentRate"] as const;

export function buildAttendanceRows(records: CandidateAttendanceRecord[], view: AttendanceView): AttendanceGridRow[] {
  const dimensions = attendanceDimensions[view];
  const groups = new Map<string, AttendanceGridRow>();
  for (const record of records) {
    const id = view === "candidate" ? String(record.id) : JSON.stringify(dimensions.map((key) => record[key]));
    let row = groups.get(id);
    if (!row) {
      row = {
        id,
        values: Object.fromEntries(dimensions.map((key) => [key, record[key]])),
        total: 0,
        present: 0,
        absent: 0,
      };
      groups.set(id, row);
    }
    row.total++;
    row.present += Number(record.attendance === "응시");
    row.absent += Number(record.attendance === "결시");
  }
  return [...groups.values()];
}

export function attendanceValue(row: AttendanceGridRow, key: AttendanceColumn): string {
  if (key === "presentRate" || key === "absentRate") {
    const count = key === "presentRate" ? row.present : row.absent;
    return `${(row.total ? (count / row.total) * 100 : 0).toFixed(1)}%`;
  }
  if (key === "total" || key === "present" || key === "absent") return String(row[key]);
  return row.values[key] || "미지정";
}

export function attendanceTotals(rows: AttendanceGridRow[]): AttendanceGridRow {
  return rows.reduce(
    (sum, row) => ({
      ...sum,
      total: sum.total + row.total,
      present: sum.present + row.present,
      absent: sum.absent + row.absent,
    }),
    { id: "total", values: {}, total: 0, present: 0, absent: 0 },
  );
}
