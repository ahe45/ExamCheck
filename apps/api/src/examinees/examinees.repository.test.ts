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
    expect(execute.mock.calls[0]?.[0]).toContain("GROUP BY cr.exam_date, cr.start_time, cr.period_name, cr.admission");
    expect(execute.mock.calls[0]?.[0]).toContain("NULLIF(cr.temporary_no, '') IS NOT NULL");
  });

  it("수험생 조회에 실제 전송 완료된 마지막 라벨 출력시각을 포함한다", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const repository = new ExamineesRepository({ execute } as unknown as Pool);

    await repository.listRoster(
      { date: "2026-10-30", time: "10:00", periodName: "1교시", admissionName: "면접" },
      "면접",
    );

    expect(execute.mock.calls[0]?.[0]).toContain("MAX(sent_at) AS last_printed_at");
    expect(execute.mock.calls[0]?.[0]).toContain("status = 'SENT'");
    expect(execute.mock.calls[0]?.[0]).toContain("printed.last_printed_at AS lastPrintedAt");
  });
});
