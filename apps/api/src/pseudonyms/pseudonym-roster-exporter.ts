import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import type { PseudonymRosterExportRow } from "./pseudonym-roster-query.js";

@Injectable()
export class PseudonymRosterExporter {
  async build(rows: PseudonymRosterExportRow[], options: { labelPrintingEnabled: boolean }): Promise<Buffer> {
    const workbook = this.createWorkbook(rows, options);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  createWorkbook(
    rows: PseudonymRosterExportRow[],
    options: { labelPrintingEnabled: boolean },
    createdAt = new Date(),
  ): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "가번호 관리 시스템";
    workbook.created = createdAt;
    const worksheet = workbook.addWorksheet("가번호 등록 현황", { views: [{ state: "frozen", ySplit: 1 }] });
    worksheet.columns = [
      { header: "순번", key: "sequence", width: 9 },
      { header: "가번호", key: "pseudonymNumber", width: 14 },
      { header: "수험번호", key: "examineeNo", width: 18 },
      { header: "성명", key: "name", width: 16 },
      { header: "모집단위", key: "unitName", width: 28 },
      { header: "전공", key: "majorName", width: 28 },
      {
        header: options.labelPrintingEnabled ? "출력일시" : "등록일시",
        key: options.labelPrintingEnabled ? "printedAt" : "assignedAt",
        width: 24,
      },
      { header: "응시 여부", key: "attendance", width: 12 },
      { header: "상태", key: "status", width: 12 },
    ];
    worksheet.addRows(rows);
    const header = worksheet.getRow(1);
    header.height = 24;
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.alignment = { horizontal: "center", vertical: "middle" };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2D63F5" } };
    worksheet.eachRow((row, rowNumber) => {
      row.alignment = { horizontal: "center", vertical: "middle" };
      if (rowNumber > 1) row.height = 21;
      row.eachCell((cell) => {
        cell.border = { bottom: { style: "thin", color: { argb: "FFE1E6ED" } } };
      });
    });
    worksheet.autoFilter = { from: "A1", to: "I1" };
    return workbook;
  }
}
