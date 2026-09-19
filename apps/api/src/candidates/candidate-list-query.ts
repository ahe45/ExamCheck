import { BadRequestException } from "@nestjs/common";
import { candidateFields, type CandidateFieldKey } from "./candidate-fields.js";

export interface CandidateListQuery {
  page: number;
  pageSize: number;
  sort: { key: CandidateFieldKey; direction: "asc" | "desc" } | null;
  filters: Partial<Record<CandidateFieldKey, string[]>>;
}

export function candidateColumn(key: string): string {
  const field = candidateFields.find((field) => field.key === key);
  if (!field) throw new BadRequestException("조회할 열을 확인해 주세요.");
  return field.format === "date"
    ? `COALESCE(DATE_FORMAT(cr.${field.dbColumn}, '%Y-%m-%d'), '')`
    : `cr.${field.dbColumn}`;
}

export function parseCandidateListQuery(raw?: string): CandidateListQuery {
  let input: Record<string, unknown>;
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    throw new BadRequestException("조회 조건을 확인해 주세요.");
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !["page", "pageSize", "sort", "filters"].includes(key))
  )
    throw new BadRequestException("조회 조건을 확인해 주세요.");
  const page = input.page ?? 1,
    pageSize = input.pageSize ?? 30;
  if (
    !Number.isSafeInteger(page) ||
    Number(page) < 1 ||
    Number(page) > 1_000_000 ||
    ![30, 50, 100, 200, 500].includes(Number(pageSize))
  )
    throw new BadRequestException("페이지 크기를 확인해 주세요.");
  let sort: CandidateListQuery["sort"] = null;
  if (input.sort) {
    const value = input.sort as Record<string, unknown>;
    candidateColumn(String(value.key));
    if (!["asc", "desc"].includes(String(value.direction))) throw new BadRequestException("정렬 방향을 확인해 주세요.");
    sort = { key: value.key as CandidateFieldKey, direction: value.direction as "asc" | "desc" };
  }
  const filters: CandidateListQuery["filters"] = {};
  if (
    input.filters !== undefined &&
    (!input.filters || typeof input.filters !== "object" || Array.isArray(input.filters))
  )
    throw new BadRequestException("필터를 확인해 주세요.");
  for (const [key, values] of Object.entries(input.filters ?? {})) {
    candidateColumn(key);
    if (
      !Array.isArray(values) ||
      values.length > 50000 ||
      values.some((value) => typeof value !== "string" || value.length > 1000)
    )
      throw new BadRequestException("필터 값을 확인해 주세요.");
    if (values.length) filters[key as CandidateFieldKey] = [...new Set(values)];
  }
  if (Object.values(filters).reduce((total, values) => total + values.length, 0) > 60000)
    throw new BadRequestException("선택한 필터 값이 너무 많습니다. 검색 조건을 좁혀 주세요.");
  return { page: Number(page), pageSize: Number(pageSize), sort, filters };
}

export function candidateListSql(query: CandidateListQuery) {
  const predicates: string[] = [];
  const parameters: string[] = [];
  for (const [key, values] of Object.entries(query.filters)) {
    if (!values?.length) continue;
    predicates.push(`BINARY ${candidateColumn(key)} IN (${values.map(() => "?").join(",")})`);
    parameters.push(...values);
  }
  const column = query.sort ? candidateColumn(query.sort.key) : "cr.id";
  const direction = query.sort?.direction === "desc" ? "DESC" : "ASC";
  // MariaDB natural keys preserve the grid's numeric text order (2 before 10).
  const order = query.sort ? `NATURAL_SORT_KEY(${column}) ${direction}, cr.id ASC` : "cr.id ASC";
  return { where: predicates.length ? `WHERE ${predicates.join(" AND ")}` : "", parameters, order };
}
