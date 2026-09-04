import { describe, expect, it, vi } from "vitest";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { LabelTemplatesRepository } from "./label-templates.repository.js";

describe("LabelTemplatesRepository", () => {
  it("양식 코드로 편집 대상 행을 잠근다", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const repository = new LabelTemplatesRepository();

    await expect(repository.findForUpdate({ execute } as unknown as SqlExecutor, "LABEL_CARD")).resolves.toBeNull();

    expect(execute).toHaveBeenCalledWith(expect.stringContaining("template.code = ?"), ["LABEL_CARD"]);
    expect(execute.mock.calls[0]?.[0]).toContain("FOR UPDATE");
  });
});
