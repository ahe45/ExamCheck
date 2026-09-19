import { describe, expect, it } from "vitest";
import { candidateListSql, parseCandidateListQuery } from "./candidate-list-query.js";

describe("server candidate query", () => {
  it.each([
    { sort: { key: "id; DROP TABLE candidate_record", direction: "asc" } },
    { pageSize: 0 },
    { filters: { name: "invalid" } },
    { sort: { key: "name", direction: "DESC; SELECT 1" } },
  ])("rejects invalid query input %j", (input) => {
    expect(() => parseCandidateListQuery(JSON.stringify(input))).toThrow();
  });
  it("binds filter values and uses a stable numeric sort", () => {
    const query = parseCandidateListQuery(
      JSON.stringify({
        filters: { name: ["O'Reilly", "홍길동", "O'Reilly"] },
        sort: { key: "examineeNo", direction: "desc" },
      }),
    );
    const sql = candidateListSql(query);
    expect(sql.parameters).toEqual(["O'Reilly", "홍길동"]);
    expect(sql.where).not.toContain("O'Reilly");
    expect(sql.where).toContain("BINARY cr.name IN (?,?)");
    expect(sql.order).toContain("cr.id ASC");
  });
});
