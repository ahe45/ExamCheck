import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { ExamineesRepository } from "./examinees.repository.js";

describe("ExamineesRepository", () => {
  it("normalizes schedule counts and building aggregates at the row boundary", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          date: "2026-10-30",
          time: "10:00",
          periodName: "1교시",
          admissionName: "면접",
          buildingNames: "본관\u001f별관",
          candidateCount: "12",
          assignedCount: "3",
        },
      ],
      [],
    ]);
    const repository = new ExamineesRepository({ execute } as unknown as Pool);

    await expect(repository.listSchedules({ sql: "1 = 1", params: [] })).resolves.toEqual([
      {
        date: "2026-10-30",
        time: "10:00",
        periodName: "1교시",
        admissionName: "면접",
        buildingNames: ["본관", "별관"],
        candidateCount: 12,
        assignedCount: 3,
      },
    ]);
  });
});
