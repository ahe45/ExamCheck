import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { FormTemplatesRepository } from "./form-templates.repository.js";

describe("FormTemplatesRepository", () => {
  it("maps persisted JSON and active state at the infrastructure boundary", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          id: 8,
          code: "CANDIDATE_CARD",
          version: 2,
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

    await expect(repository.listLatest(true)).resolves.toMatchObject([
      { code: "CANDIDATE_CARD", active: true, layout: { pages: [] } },
    ]);
    expect(execute.mock.calls[0]?.[0]).toContain("WHERE ft.active = TRUE");
  });
});
