import { attendanceLabels, attendanceValue, type AttendanceColumn, type AttendanceGridRow } from "./attendance-model";

export async function buildAttendanceWorkbook(
  columns: readonly AttendanceColumn[],
  rows: readonly AttendanceGridRow[],
) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("응시 현황", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "순번", width: 8 },
    ...columns.map((key) => ({ header: attendanceLabels[key], width: 18 })),
  ];
  sheet.getRow(1).font = { bold: true };
  for (const key of ["presentRate", "absentRate"] as const) {
    const index = columns.indexOf(key);
    if (index >= 0) sheet.getColumn(index + 2).numFmt = "0.0%";
  }

  rows.forEach((row, index) => {
    sheet.addRow([index + 1, ...columns.map((key) => exportValue(row, key))]);
  });
  const data = new Uint8Array(await workbook.xlsx.writeBuffer());
  return new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function exportValue(row: AttendanceGridRow, key: AttendanceColumn) {
  if (key === "total" || key === "present" || key === "absent") return row[key];
  if (key === "presentRate") return row.total ? row.present / row.total : 0;
  if (key === "absentRate") return row.total ? row.absent / row.total : 0;
  return attendanceValue(row, key);
}
