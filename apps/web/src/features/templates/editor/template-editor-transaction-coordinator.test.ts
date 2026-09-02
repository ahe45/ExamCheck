// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  createTemplateEditorTransactionCoordinator,
  resolveTemplateEditorScope,
} from "./template-editor-transaction-coordinator";

describe("template editor transaction coordinator", () => {
  it("문서 변경을 하나의 커밋으로 합치고 변경 이유와 리비전을 보존한다", () => {
    const surface = document.createElement("div");
    const scheduled: Array<() => void> = [];
    const commit = vi.fn();
    const onDirty = vi.fn();
    const coordinator = createTemplateEditorTransactionCoordinator({
      commit,
      documentSurface: surface,
      onDirty,
      schedule: (callback) => scheduled.push(callback),
    });

    coordinator.request("object.move");
    coordinator.request("object.resize");

    expect(onDirty).toHaveBeenCalledTimes(2);
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.();
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({ reasons: ["object.move", "object.resize"], revision: 2 }),
    );
  });

  it("데이터블록 편집 중에는 상위 문서 커밋을 막고 종료 요청에서 한 번만 반영한다", () => {
    const surface = document.createElement("div");
    surface.innerHTML = `
      <div data-candidate-block-focus-layer>
        <div data-candidate-block-modal-editor-surface data-candidate-block-editor-surface-id="dataBlock"
          data-template-editor-runtime-active-surface="true"></div>
      </div>
    `;
    const scheduled: Array<() => void> = [];
    const commit = vi.fn();
    const coordinator = createTemplateEditorTransactionCoordinator({
      commit,
      documentSurface: surface,
      onDirty: vi.fn(),
      schedule: (callback) => scheduled.push(callback),
    });

    expect(resolveTemplateEditorScope(surface)).toMatchObject({
      id: "candidate-block:dataBlock",
      kind: "candidate-block",
    });
    coordinator.request("table.insert");
    scheduled.shift()?.();
    expect(commit).not.toHaveBeenCalled();

    surface.replaceChildren();
    coordinator.request("candidate-block.commit");
    scheduled.shift()?.();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({ reasons: ["table.insert", "candidate-block.commit"], revision: 2 }),
    );
  });
});
