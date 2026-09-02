import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { FormTemplatesRepository } from "./form-templates.repository.js";

describe("FormTemplatesRepository", () => {
  it("maps persisted JSON and active state without exposing version metadata", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          id: 8,
          code: "CANDIDATE_CARD",
          name: "수험표",
          description: null,
          category: "수험생",
          usageScope: "CANDIDATE",
          layout: '{"pages":[]}',
          active: 1,
          createdAt: new Date("2026-08-28T00:00:00.000Z"),
          createdByLoginId: "admin",
        },
      ],
      [],
    ]);
    const repository = new FormTemplatesRepository({ execute } as unknown as Pool);

    await expect(repository.list(true)).resolves.toMatchObject([
      { code: "CANDIDATE_CARD", active: true, layout: { pages: [] } },
    ]);
    const sql = String(execute.mock.calls[0]?.[0]);
    expect(sql).toContain("ft.active = TRUE");
    expect(sql).not.toContain("version");
    expect(sql).not.toContain("lifecycle_state");
  });
});
