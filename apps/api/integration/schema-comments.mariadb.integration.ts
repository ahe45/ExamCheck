import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";

interface DocumentationCountRow extends RowDataPacket {
  totalCount: number;
  undocumentedCount: number;
}

interface CommentRow extends RowDataPacket {
  comment: string;
}

describe("database schema documentation comments", () => {
  let harness: MariaDbIntegrationHarness;

  beforeAll(async () => {
    harness = await createMariaDbIntegrationHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it("documents every application table and column", async () => {
    const [tableCounts] = await harness.pool.query<DocumentationCountRow[]>(
      `SELECT COUNT(*) AS totalCount,
              SUM(CASE WHEN TRIM(TABLE_COMMENT) = '' THEN 1 ELSE 0 END) AS undocumentedCount
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
    );
    const [columnCounts] = await harness.pool.query<DocumentationCountRow[]>(
      `SELECT COUNT(*) AS totalCount,
              SUM(CASE WHEN TRIM(COLUMN_COMMENT) = '' THEN 1 ELSE 0 END) AS undocumentedCount
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()`,
    );

    expect(Number(tableCounts[0]?.totalCount)).toBeGreaterThan(0);
    expect(Number(tableCounts[0]?.undocumentedCount)).toBe(0);
    expect(Number(columnCounts[0]?.totalCount)).toBeGreaterThan(0);
    expect(Number(columnCounts[0]?.undocumentedCount)).toBe(0);
  });

  it("keeps representative comments specific to their business meaning", async () => {
    const [tableRows] = await harness.pool.query<CommentRow[]>(
      `SELECT TABLE_COMMENT AS comment
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pseudonym_assignment'`,
    );
    const [columnRows] = await harness.pool.query<CommentRow[]>(
      `SELECT COLUMN_COMMENT AS comment
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'form_template'
         AND COLUMN_NAME = 'layout_json'`,
    );

    expect(tableRows[0]?.comment).toContain("가번호 배정 결과");
    expect(columnRows[0]?.comment).toContain("양식 레이아웃 JSON");
  });
});
