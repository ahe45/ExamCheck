import { describe, expect, it, vi } from "vitest";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { LabelTemplatesRepository } from "./label-templates.repository.js";

describe("LabelTemplatesRepository", () => {
  it("목록 썸네일에 저장된 개체 회전값을 포함한다", async () => {
    const layout = {
      widthMm: 75,
      heightMm: 45,
      dpi: 203,
      elements: [
        { id: "text", kind: "text", xMm: 4, yMm: 3, widthMm: 30, heightMm: 8, content: "시험", rotation: 270 },
      ],
    };
    const execute = vi.fn().mockResolvedValue([[{ id: 1, layout: JSON.stringify(layout) }], []]);
    const summaries = await new LabelTemplatesRepository().listSummaries({ execute } as unknown as SqlExecutor);
    expect(summaries[0]?.thumbnail.elements[0]).toMatchObject({ rotation: 270 });
  });

  it("양식 코드로 편집 대상 행을 잠근다", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const repository = new LabelTemplatesRepository();

    await expect(repository.findForUpdate({ execute } as unknown as SqlExecutor, "LABEL_CARD")).resolves.toBeNull();

    expect(execute).toHaveBeenCalledWith(expect.stringContaining("template.code = ?"), ["LABEL_CARD"]);
    expect(execute.mock.calls[0]?.[0]).toContain("FOR UPDATE");
  });
});
