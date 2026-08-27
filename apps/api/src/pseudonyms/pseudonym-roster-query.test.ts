import { describe, expect, it } from "vitest";
import {
  applyOperationRosterQuery,
  buildOperationRosterFilterSql,
  type CanonicalPseudonymRosterRow,
} from "./pseudonym-roster-query.js";

const rows: CanonicalPseudonymRosterRow[] = [
  {
    pseudonymNumber: "9",
    examineeNo: "10002",
    name: "김지원",
    unitName: "디자인학부",
    majorName: "시각디자인",
    assignedAt: "26.09.01. 09:02:00",
    status: "등록",
  },
  {
    pseudonymNumber: "10",
    examineeNo: "10001",
    name: "이수험",
    unitName: "디자인학부",
    majorName: "산업디자인",
    assignedAt: "26.09.01. 09:01:00",
    status: "등록",
  },
  {
    pseudonymNumber: "-",
    examineeNo: "10003",
    name: "박대기",
    unitName: "체육학부",
    majorName: "-",
    assignedAt: "-",
    status: "대기",
  },
];

describe("pseudonym roster export query", () => {
  it("applies the same exact-value filters and Korean numeric sort used by the client grid", () => {
    expect(
      applyOperationRosterQuery(rows, {
        filters: [{ field: "status", mode: "include", values: ["등록"] }],
        sort: { field: "pseudonymNumber", direction: "desc" },
      }),
    ).toEqual([
      { sequence: 1, ...rows[1] },
      { sequence: 2, ...rows[0] },
    ]);
  });

  it("builds only allowlisted parameterized filter predicates", () => {
    const result = buildOperationRosterFilterSql([
      { field: "status", mode: "include", values: ["등록", "결시"] },
      { field: "majorName", mode: "exclude", values: ["-"] },
    ]);

    expect(result.sql).toContain("CAST(CASE WHEN");
    expect(result.sql).toContain("IN (?, ?)");
    expect(result.sql).toContain("CAST(COALESCE(NULLIF(cr.major, ''), '-') AS BINARY) NOT IN (?)");
    expect(result.parameters).toEqual(["등록", "결시", "-"]);
  });

  it("rejects duplicate or runtime-forged fields even when called outside the HTTP validation pipe", () => {
    expect(() =>
      buildOperationRosterFilterSql([
        { field: "status", mode: "include", values: ["등록"] },
        { field: "status", mode: "exclude", values: ["대기"] },
      ]),
    ).toThrow("중복");
    expect(() =>
      buildOperationRosterFilterSql([{ field: "unsafe" as "status", mode: "include", values: ["anything"] }]),
    ).toThrow("허용되지 않은");
  });
});
