import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { PseudonymRosterExporter } from "./pseudonym-roster-exporter.js";
import type { PseudonymRosterExportRow } from "./pseudonym-roster-query.js";

const row: PseudonymRosterExportRow = {
  sequence: 1,
  pseudonymNumber: "1001",
  examineeNo: "20260001",
  name: "홍길동",
  unitName: "디자인학부",
  majorName: "시각디자인",
  assignedAt: "26.09.01. 09:01:02",
  printedAt: "26.09.01. 09:02:03",
  attendance: "응시",
  status: "마감",
};

describe("PseudonymRosterExporter", () => {
  it("creates the established roster sheet, columns, values, and styles", () => {
    const createdAt = new Date("2026-09-01T00:00:00.000Z");
    const workbook = new PseudonymRosterExporter().createWorkbook([row], { labelPrintingEnabled: false }, createdAt);
    const worksheet = workbook.getWorksheet("가번호 등록 현황");

    expect(workbook.creator).toBe("가번호 관리 시스템");
    expect(workbook.created).toEqual(createdAt);
    expect(worksheet).toBeDefined();
    expect(worksheet?.views).toEqual([expect.objectContaining({ state: "frozen", ySplit: 1 })]);
    expect(worksheet?.getRow(1).values).toEqual([
      undefined,
      "순번",
      "가번호",
      "수험번호",
      "성명",
      "모집단위",
      "전공",
      "등록일시",
      "응시 여부",
      "상태",
    ]);
    expect(worksheet?.columns.map((column) => column.width)).toEqual([9, 14, 18, 16, 28, 28, 24, 12, 12]);
    expect(worksheet?.getRow(2).values).toEqual([
      undefined,
      1,
      "1001",
      "20260001",
      "홍길동",
      "디자인학부",
      "시각디자인",
      "26.09.01. 09:01:02",
      "응시",
      "마감",
    ]);

    const header = worksheet?.getRow(1);
    expect(header?.height).toBe(24);
    expect(header?.font).toMatchObject({ bold: true, color: { argb: "FFFFFFFF" } });
    expect(header?.alignment).toMatchObject({ horizontal: "center", vertical: "middle" });
    expect(header?.fill).toMatchObject({ type: "pattern", pattern: "solid", fgColor: { argb: "FF2D63F5" } });
    expect(worksheet?.getRow(2).height).toBe(21);
    expect(worksheet?.getRow(2).alignment).toMatchObject({ horizontal: "center", vertical: "middle" });
    expect(worksheet?.getCell("A2").border.bottom).toMatchObject({ style: "thin", color: { argb: "FFE1E6ED" } });
    expect(worksheet?.autoFilter).toEqual({ from: "A1", to: "I1" });
  });

  it("serializes a valid XLSX buffer with the same visible sheet data", async () => {
    const buffer = await new PseudonymRosterExporter().build([row], { labelPrintingEnabled: true });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const worksheet = workbook.getWorksheet("가번호 등록 현황");

    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");
    expect(worksheet?.rowCount).toBe(2);
    expect(worksheet?.getCell("B2").value).toBe("1001");
    expect(worksheet?.getCell("G1").value).toBe("출력일시");
    expect(worksheet?.getCell("G2").value).toBe("26.09.01. 09:02:03");
    expect(worksheet?.getCell("H2").value).toBe("응시");
    expect(worksheet?.getCell("I2").value).toBe("마감");
  });
});
