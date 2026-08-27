import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { WorkstationsRepository } from "./workstations.repository.js";

describe("WorkstationsRepository", () => {
  it("maps the persisted enabled flag and keeps the canonical ordering query", async () => {
    const createdAt = new Date("2026-08-28T00:00:00.000Z");
    const query = vi.fn().mockResolvedValue([
      [
        {
          id: 3,
          code: "GT800-01",
          name: "운영 프린터",
          location: null,
          description: null,
          enabled: 1,
          createdAt,
        },
      ],
      [],
    ]);
    const repository = new WorkstationsRepository({ query } as unknown as Pool);

    await expect(repository.list()).resolves.toEqual([
      {
        id: 3,
        code: "GT800-01",
        name: "운영 프린터",
        location: null,
        description: null,
        enabled: true,
        createdAt,
      },
    ]);
    expect(query.mock.calls[0]?.[0]).toContain("ORDER BY code");
  });
});
