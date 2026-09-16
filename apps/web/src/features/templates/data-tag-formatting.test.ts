import { describe, expect, it } from "vitest";
import {
  formatTemplateDataTagValue,
  getDataTagFormatInputError,
  getDataTagFormatOptions,
  getDataTagFormatType,
} from "./data-tag-formatting";

describe("date and time tag formats", () => {
  it.each([
    ["candidate.examDate", "2026-10-30", "YYYY년 M월 D일 (ddd)", "2026년 10월 30일 (금)"],
    ["candidate.birthDate", "2008-07-24", "YY.MM.DD", "08.07.24"],
    ["candidate.examStartTime", "00:05", "A h시 mm분", "오전 12시 05분"],
    ["candidate.examEndTime", "12:00", "A h:mm", "오후 12:00"],
    ["system.printedAt", "2026-09-16 17:40", "YYYY.MM.DD (ddd) A h:mm", "2026.09.16 (수) 오후 5:40"],
    ["system.printedAt", "2026. 9. 16. 오후 5:40", "YYYY-MM-DD HH:mm", "2026-09-16 17:40"],
    ["system.printedAt", "2026. 9. 16. 오전 12:05", "M/D HH:mm", "9/16 00:05"],
    ["system.printedAt", "2026-09-16 17:40", "YYYY.MM.DD", "2026.09.16"],
    ["system.printedAt", "2026-09-16 17:40", "HH:mm", "17:40"],
  ])("formats %s without changing local time", (key, source, pattern, expected) => {
    expect(formatTemplateDataTagValue(key, source, pattern)).toBe(expected);
  });
  it.each(["", "invalid", "2026-02-30 09:00", "2026-09-16 24:00"])("preserves empty or invalid values: %s", (value) => {
    expect(formatTemplateDataTagValue("system.printedAt", value, "YYYY.MM.DD HH:mm")).toBe(value);
  });
  it("preserves default display and validates presets and custom patterns", () => {
    expect(formatTemplateDataTagValue("system.printedAt", "2026. 9. 16. 오후 5:40")).toBe("2026. 9. 16. 오후 5:40");
    for (const type of ["date", "time", "datetime"]) {
      for (const option of getDataTagFormatOptions(type))
        expect(getDataTagFormatInputError(type, option.value)).toBe("");
    }
    for (const invalid of ["YYYY <script>", "yyyy-mm-dd", "YYYY ZZ", "한글만", "Y".repeat(61)]) {
      expect(getDataTagFormatInputError("datetime", invalid)).not.toBe("");
    }
    expect(getDataTagFormatType({ key: "custom", type: "datetime" })).toBe("datetime");
  });
});
