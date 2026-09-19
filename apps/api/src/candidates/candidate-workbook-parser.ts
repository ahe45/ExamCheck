import { BadRequestException } from "@nestjs/common";
import ExcelJS from "exceljs";
import { assertWorkbookBuffer } from "./candidate-upload-security.js";
import { validateCandidateWorkbookHeaders, normalizeAndValidateCandidate } from "./candidate-domain.js";
import { candidateFields, candidateKey, type CandidateInput, type CandidateFieldKey } from "./candidate-fields.js";
export async function parseCandidateWorkbook(buffer: Buffer): Promise<CandidateInput[]> {
  assertWorkbookBuffer(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as never);
  } catch {
    throw new BadRequestException("XLSX 파일을 읽을 수 없습니다.");
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new BadRequestException("XLSX 파일에서 시트를 찾을 수 없습니다.");
  const headerRow = worksheet.getRow(1);
  const actualHeaders = Array.from({ length: Math.max(headerRow.cellCount, worksheet.columnCount) }, (_, index) =>
    cellText(headerRow.getCell(index + 1)),
  );
  while (actualHeaders.at(-1) === "") actualHeaders.pop();
  validateCandidateWorkbookHeaders(actualHeaders);
  const indexes = new Map<CandidateFieldKey, number>();
  candidateFields.forEach((field, index) => indexes.set(field.key, index + 1));
  const candidates: CandidateInput[] = [];
  const keys = new Set<string>();
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const rawCandidate = {} as CandidateInput;
    let hasValue = false;
    for (const field of candidateFields) {
      const index = indexes.get(field.key) || -1;
      const cell = index > 0 ? row.getCell(index) : null;
      const value = cell ? cellText(cell, false) : "";
      rawCandidate[field.key] = value;
      hasValue ||= value !== "";
    }
    if (!hasValue) continue;
    const candidate = normalizeAndValidateCandidate(rawCandidate, rowNumber);
    const key = candidateKey(candidate);
    if (keys.has(key)) {
      throw new BadRequestException(
        `수험번호, 시험날짜, 시험시간, 교시명 조합이 XLSX 안에서 중복되었습니다. (${rowNumber}행)`,
      );
    }
    keys.add(key);
    candidates.push(candidate);
  }
  if (!candidates.length) {
    throw new BadRequestException("XLSX에는 헤더와 최소 1개 이상의 데이터 행이 필요합니다.");
  }
  return candidates;
}

function cellText(cell: ExcelJS.Cell, trim = true) {
  const value = cell.value;
  let text = "";
  if (value == null) text = "";
  else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") text = String(value);
  else if (value instanceof Date) {
    text = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  } else if ("text" in value && typeof value.text === "string") text = value.text;
  else if ("richText" in value && Array.isArray(value.richText)) {
    text = value.richText.map((part) => part.text).join("");
  } else if ("result" in value && value.result != null) text = String(value.result);
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return trim ? text.trim() : text;
}
