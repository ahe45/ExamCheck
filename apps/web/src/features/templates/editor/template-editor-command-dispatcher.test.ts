// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { TemplateEditorInstance } from "../../../shared/templates/template-editor-contracts";
import { createTemplateEditorCommandDispatcher } from "./template-editor-command-dispatcher";
import { createTemplateEditorTransactionCoordinator } from "./template-editor-transaction-coordinator";

describe("template editor command dispatcher", () => {
  it("툴바 포커스 이동 뒤에도 캔버스 선택을 복원하고 명령을 한 트랜잭션으로 기록한다", () => {
    const surface = document.createElement("div");
    surface.innerHTML = "<p>연속 서식</p>";
    document.body.append(surface);
    const text = surface.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()!.addRange(range);
    const runtimeState = { templateEditor: {} as Record<string, unknown> };
    const editor = { getRuntime: () => ({ state: runtimeState }) } as unknown as TemplateEditorInstance;
    const scheduled: Array<() => void> = [];
    const commit = vi.fn();
    const transactions = createTemplateEditorTransactionCoordinator({
      commit,
      documentSurface: surface,
      onDirty: vi.fn(),
      schedule: (callback) => scheduled.push(callback),
    });
    const commands = createTemplateEditorCommandDispatcher({ documentSurface: surface, editor, transactions });

    commands.captureSelection();
    window.getSelection()!.removeAllRanges();
    const mutate = vi.fn(() => true);
    expect(commands.execute({ id: "text.bold", mutate })).toBe(true);
    expect(mutate).toHaveBeenCalledOnce();
    expect(window.getSelection()!.toString()).toBe("연속 서식");
    scheduled.shift()?.();
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ reasons: ["command.text.bold"] }));
    transactions.dispose();
    surface.remove();
  });

  it("데이터블록 초안 명령은 적용 전 문서 트랜잭션을 만들지 않는다", () => {
    const surface = document.createElement("div");
    surface.innerHTML = `
      <div data-candidate-block-focus-layer>
        <div data-candidate-block-modal-editor-surface data-template-editor-runtime-active-surface="true"><p>초안</p></div>
      </div>`;
    const editor = { getRuntime: () => ({ state: { templateEditor: {} } }) } as unknown as TemplateEditorInstance;
    const onDirty = vi.fn();
    const transactions = createTemplateEditorTransactionCoordinator({
      commit: vi.fn(),
      documentSurface: surface,
      onDirty,
    });
    const commands = createTemplateEditorCommandDispatcher({ documentSurface: surface, editor, transactions });

    expect(commands.execute({ id: "data-tag.format", mutate: () => true })).toBe(true);
    expect(onDirty).not.toHaveBeenCalled();
    transactions.dispose();
  });
});
