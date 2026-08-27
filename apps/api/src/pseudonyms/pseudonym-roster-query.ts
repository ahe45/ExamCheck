import { BadRequestException } from "@nestjs/common";

export const PSEUDONYM_ROSTER_EXPORT_FIELDS = [
  "pseudonymNumber",
  "examineeNo",
  "name",
  "unitName",
  "majorName",
  "assignedAt",
  "status",
] as const;

export const PSEUDONYM_ROSTER_EXPORT_MAX_ROWS = 10_000;
export const PSEUDONYM_ROSTER_EXPORT_MAX_FILTER_VALUES = 10_000;

export type PseudonymRosterExportField = (typeof PSEUDONYM_ROSTER_EXPORT_FIELDS)[number];
export type PseudonymRosterFilterMode = "include" | "exclude";

export interface PseudonymRosterFilterSpecification {
  field: PseudonymRosterExportField;
  mode: PseudonymRosterFilterMode;
  values: string[];
}

export interface PseudonymRosterSortSpecification {
  field: PseudonymRosterExportField;
  direction: "asc" | "desc";
}

export interface PseudonymRosterQuerySpecification {
  filters: PseudonymRosterFilterSpecification[];
  sort?: PseudonymRosterSortSpecification;
}

export interface CanonicalPseudonymRosterRow {
  pseudonymNumber: string;
  examineeNo: string;
  name: string;
  unitName: string;
  majorName: string;
  assignedAt: string;
  status: "등록" | "대기" | "결시";
}

export interface PseudonymRosterExportRow extends CanonicalPseudonymRosterRow {
  sequence: number;
}

const valueSql: Record<PseudonymRosterExportField, string> = {
  pseudonymNumber: "COALESCE(pa.pseudonym_no, '-')",
  examineeNo: "cr.examinee_no",
  name: "cr.name",
  unitName: "COALESCE(NULLIF(cr.unit_name, ''), '-')",
  majorName: "COALESCE(NULLIF(cr.major, ''), '-')",
  assignedAt: "COALESCE(DATE_FORMAT(pa.assigned_at, '%y.%m.%d. %H:%i:%s'), '-')",
  status: "CASE WHEN COALESCE(pa.is_absentee, FALSE) THEN '결시' WHEN pa.id IS NOT NULL THEN '등록' ELSE '대기' END",
};

export function operationRosterSelectSql(): string {
  return PSEUDONYM_ROSTER_EXPORT_FIELDS.map((field) => `${valueSql[field]} AS ${field}`).join(",\n              ");
}

export function buildOperationRosterFilterSql(filters: PseudonymRosterFilterSpecification[]): {
  sql: string;
  parameters: string[];
} {
  assertOperationRosterQuery({ filters });
  const parameters: string[] = [];
  const conditions = filters.map((filter) => {
    parameters.push(...filter.values);
    const comparison = filter.mode === "include" ? "IN" : "NOT IN";
    return `CAST(${valueSql[filter.field]} AS BINARY) ${comparison} (${filter.values.map(() => "?").join(", ")})`;
  });
  return {
    sql: conditions.length ? ` AND ${conditions.join(" AND ")}` : "",
    parameters,
  };
}

export function applyOperationRosterQuery(
  rows: CanonicalPseudonymRosterRow[],
  query: PseudonymRosterQuerySpecification,
): PseudonymRosterExportRow[] {
  assertOperationRosterQuery(query);
  const filtered = rows.filter((row) =>
    query.filters.every((filter) => {
      const included = filter.values.includes(row[filter.field]);
      return filter.mode === "include" ? included : !included;
    }),
  );
  const sort = query.sort;
  const sorted = sort
    ? [...filtered].sort((left, right) => {
        const multiplier = sort.direction === "desc" ? -1 : 1;
        return (
          left[sort.field].localeCompare(right[sort.field], "ko", {
            numeric: true,
            sensitivity: "base",
          }) * multiplier
        );
      })
    : filtered;
  return sorted.map((row, index) => ({ sequence: index + 1, ...row }));
}

export function assertOperationRosterQuery(query: PseudonymRosterQuerySpecification): void {
  if (query.filters.length > PSEUDONYM_ROSTER_EXPORT_FIELDS.length) {
    throw new BadRequestException("엑셀 필터 조건이 허용된 개수를 초과했습니다.");
  }
  const fields = new Set<PseudonymRosterExportField>();
  for (const filter of query.filters) {
    if (!PSEUDONYM_ROSTER_EXPORT_FIELDS.includes(filter.field)) {
      throw new BadRequestException("허용되지 않은 엑셀 필터 열입니다.");
    }
    if (filter.mode !== "include" && filter.mode !== "exclude") {
      throw new BadRequestException("허용되지 않은 엑셀 필터 방식입니다.");
    }
    if (fields.has(filter.field)) throw new BadRequestException("동일한 엑셀 필터 열이 중복되었습니다.");
    fields.add(filter.field);
    if (!filter.values.length || filter.values.length > PSEUDONYM_ROSTER_EXPORT_MAX_FILTER_VALUES) {
      throw new BadRequestException("엑셀 필터 값의 개수가 허용 범위를 벗어났습니다.");
    }
  }
  if (query.sort && !PSEUDONYM_ROSTER_EXPORT_FIELDS.includes(query.sort.field)) {
    throw new BadRequestException("허용되지 않은 엑셀 정렬 열입니다.");
  }
  if (query.sort && query.sort.direction !== "asc" && query.sort.direction !== "desc") {
    throw new BadRequestException("허용되지 않은 엑셀 정렬 방식입니다.");
  }
}
