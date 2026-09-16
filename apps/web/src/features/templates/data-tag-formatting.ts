import {
  getDataTagFormatType as getPackageFormatType,
  getDataTagFormatOptions as getPackageFormatOptions,
  getDataTagFormatTokenGuides as getPackageTokenGuides,
  getDataTagFormatInputError as getPackageInputError,
  formatDataTagSampleValue,
} from "examlist-template-editor/core";
import type { DataTagDefinition } from "../../shared/templates/template-editor-contracts";

export function getDataTagFormatType(definition: DataTagDefinition | string = ""): string {
  const key = typeof definition === "string" ? definition : definition.key || definition.dataKey;
  if (key === "system.printedAt" || (typeof definition !== "string" && definition.type === "datetime"))
    return "datetime";
  return getPackageFormatType(definition);
}

export function getDataTagFormatOptions(type: string) {
  if (type !== "datetime") return getPackageFormatOptions(type);
  return [
    { label: "기본값", preview: "2026-03-28 08:40", value: "" },
    ...[
      "YYYY-MM-DD HH:mm",
      "YYYY.MM.DD HH:mm",
      "YYYY.MM.DD (ddd) HH:mm",
      "YYYY년 M월 D일 A h시 mm분",
      "M월 D일 (ddd) A h:mm",
    ].map((value) => ({
      label: value,
      preview: renderDataTagFormatPreview(type, value),
      value,
    })),
  ];
}

export function getDataTagFormatTokenGuides(type: string) {
  return type === "datetime"
    ? [...getPackageTokenGuides("date"), ...getPackageTokenGuides("time")]
    : getPackageTokenGuides(type);
}

export function getDataTagFormatInputError(type: string, value: string): string {
  if (type !== "datetime") return getPackageInputError(type, value);
  // Use ExamList's validation after substituting the time tokens with a valid
  // date token. This preserves length and unsafe-character validation.
  if (value.trim().length > 60) return "데이터 형식은 60자 이내로 입력하세요.";
  return getPackageInputError(
    "date",
    value.replace(/HH|H|hh|h|mm|A/g, (token) => "D".repeat(token.length)),
  );
}

export function normalizeDataTagFormat(type: string, value: string): string {
  return getDataTagFormatInputError(type, value) ? "" : value.trim();
}

export function formatTemplateDataTagValue(
  definition: DataTagDefinition | string = "",
  value: unknown = "",
  format = "",
  explicitType = "",
): string {
  const type = explicitType || getDataTagFormatType(definition);
  if (type !== "datetime") return formatDataTagSampleValue(definition, value, format, type);
  const source = String(value ?? "");
  if (!format) return source;
  let normalized = source.trim();
  const korean = normalized.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2})$/);
  if (korean && Number(korean[5]) >= 1 && Number(korean[5]) <= 12) {
    const hour = (Number(korean[5]) % 12) + (korean[4] === "오후" ? 12 : 0);
    normalized = `${korean[1]}-${korean[2].padStart(2, "0")}-${korean[3].padStart(2, "0")} ${String(hour).padStart(2, "0")}:${korean[6]}`;
  }
  const parts = normalized.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/);
  if (!parts) return source;
  // Do not parse through Date: these values already represent local exam time.
  if (
    formatDataTagSampleValue("candidate.examDate", parts[1], "YYYY", "date") === parts[1] ||
    formatDataTagSampleValue("candidate.examStartTime", parts[2], "H", "time") === parts[2]
  )
    return source;
  return format.replace(/dddd|ddd|YYYY|YY|MM|M|DD|D|HH|H|hh|h|mm|A/g, (token) => {
    const dateToken = /^[YMDd]/.test(token);
    return formatDataTagSampleValue("", dateToken ? parts[1] : parts[2], token, dateToken ? "date" : "time");
  });
}

export function renderDataTagFormatPreview(type: string, format: string, sample?: string) {
  const value = sample || (type === "time" ? "08:40" : type === "datetime" ? "2026-03-28 08:40" : "2026-03-28");
  return formatTemplateDataTagValue("", value, format, type);
}
