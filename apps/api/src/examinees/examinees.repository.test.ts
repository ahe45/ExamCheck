import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { ExamineesRepository } from "./examinees.repository.js";

describe("ExamineesRepository", () => {
  it("운영 명단과 개별 수험생 조회에 저장된 대기실명을 포함한다", async () => {
    const row = { examineeNo: "10001", waitingRoom: "별관 201호" };
    const execute = vi.fn().mockResolvedValue([[row], []]);
    const repository = new ExamineesRepository({ execute } as unknown as Pool);
    const scope = { date: "2026-10-30", time: "10:00", periodName: "1교시", admissionName: "면접" };
    await expect(repository.listRoster(scope, "면접")).resolves.toEqual([row]);
    await expect(repository.findCurrent("10001", scope, "면접")).resolves.toEqual(row);
    for (const [sql] of execute.mock.calls) expect(sql).toContain("cr.waiting_room AS waitingRoom");
  });

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
          printedCount: "2",
          labelPrintingEnabled: "1",
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
        printedCount: 2,
        labelPrintingEnabled: true,
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
