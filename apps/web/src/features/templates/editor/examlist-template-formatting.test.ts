import { formatDataTagSampleValue as formatPackageDataTagSampleValue } from "examlist-template-editor";
import { describe, expect, it } from "vitest";
import type { DataTagDefinition } from "../../../shared/templates/template-editor-contracts";
import { formatProjectDataTagSampleValue } from "./examlist-template-formatting";

type FormattingCase = readonly [
  DataTagDefinition | string | undefined,
  unknown,
  string | undefined,
  string | undefined,
  string,
];

const formattingCases: readonly FormattingCase[] = [
  ["candidate.name", "홍길동", undefined, undefined, "홍길동"],
  ["candidate.examDate", "2026-11-28", "YYYY.MM.DD (ddd)", undefined, "2026.11.28 (토)"],
  ["candidate.examStartTime", "09:05", "A h:mm", undefined, "오전 9:05"],
  [{ key: "custom.date", type: "date" }, "2026-08-28", "YY/M/D", "date", "26/8/28"],
  [{ key: "custom.time", type: "time" }, "17:40", "HH:mm", "time", "17:40"],
];

describe("examlist template core formatting boundary", () => {
  it.each(formattingCases)("root package와 동일하게 %s 값을 표시한다", (definition, value, format, type, expected) => {
    expect(formatProjectDataTagSampleValue(definition, value, format, type)).toBe(expected);
    expect(formatProjectDataTagSampleValue(definition, value, format, type)).toBe(
      formatPackageDataTagSampleValue(definition, value, format, type),
    );
  });
});
