import type { Pool } from "mysql2/promise";
import { afterEach, describe, expect, it, vi } from "vitest";
import { instrumentDatabasePool } from "./database-metrics.js";
import { getCurrentDatabaseMetrics, runWithRequestContext } from "../http/request-context.js";
import { beginReadSnapshot, beginScopedWrite } from "./transaction.js";

afterEach(() => vi.unstubAllEnvs());
describe("optional database measurements", () => {
  it("keeps independent request counters without storing query text or values", async () => {
    vi.stubEnv("EXAMCHECK_PERFORMANCE_METRICS", "1");
    const query = vi.fn().mockResolvedValue([[{ id: 1 }, { id: 2 }], []]);
    const connection = { query, beginTransaction: vi.fn(), commit: vi.fn(), release: vi.fn() };
    const pool = instrumentDatabasePool({ getConnection: async () => connection } as unknown as Pool);
    const counts = await Promise.all(
      ["request-a", "request-b"].map((id) =>
        runWithRequestContext(id, async () => {
          const client = await pool.getConnection();
          await beginScopedWrite(client);
          await client.query("SELECT private_value FROM example WHERE secret = ?", ["must-not-appear"]);
          await client.commit();
          await beginReadSnapshot(client);
          await new Promise((resolve) => setTimeout(resolve, 10));
          await client.commit();
          client.release();
          return { ...getCurrentDatabaseMetrics() };
        }),
      ),
    );
    expect(counts.map((value) => value.queries)).toEqual([4, 4]);
    expect(JSON.stringify(counts)).not.toContain("private_value");
    expect(JSON.stringify(counts)).not.toContain("must-not-appear");
    expect(counts.every((value) => (value.transactionMs ?? 0) >= 8)).toBe(true);
    expect(query).toHaveBeenCalledWith("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    expect(connection.release).toHaveBeenCalledTimes(2);
  });
});
