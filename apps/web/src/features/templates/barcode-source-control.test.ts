// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { bindBarcodeSourceControl, type BarcodeSourceRequest } from "./barcode-source-control";
import { createTemplateEditorCommandDispatcher } from "./editor/template-editor-command-dispatcher";
import type { TemplateEditorInstance } from "../../shared/templates/template-editor-contracts";
import type { TemplateEditorTransactionCoordinator } from "./editor/template-editor-transaction-coordinator";

describe("document barcode source selection", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("선택 전에는 삽입하지 않고 선택 후 원래 커서에 지정한 데이터로 한 번만 삽입한다", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="editor-toolbar"><button data-template-insert="barcode">바코드</button></div><div contenteditable="true"><p>앞뒤</p></div>';
    document.body.append(root);
    const surface = root.querySelector<HTMLElement>("[contenteditable]")!;
    const range = document.createRange();
    range.setStart(surface.querySelector("p")!.firstChild!, 1);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const insertHtml = vi.fn((html: string) => {
      const selected = window.getSelection()!.getRangeAt(0);
      selected.insertNode(selected.createContextualFragment(html));
    });
    const editor = {
      getRuntime: () => ({ insertHtml, state: { templateEditor: {} } }),
    } as unknown as TemplateEditorInstance;
    const request = vi.fn();
    const transactions = {
      request,
      getScope: () => ({ kind: "document" }),
    } as unknown as TemplateEditorTransactionCoordinator;
    const commands = createTemplateEditorCommandDispatcher({ documentSurface: surface, editor, transactions });
    let picker: BarcodeSourceRequest | undefined;
    const dispose = bindBarcodeSourceControl({
      root,
      editor,
      commands,
      catalog: {
        tags: [
          { key: "candidate.examNo", label: "수험번호", example: "20260001" },
          { key: "candidate.temporaryNo", label: "가번호", example: "1501" },
          { key: "candidate.name", label: "이름", example: "홍길동" },
        ],
      },
      onOpen: (value) => {
        picker = value;
      },
    });
    const defaultInsert = vi.fn();
    root.querySelector("button")!.addEventListener("click", defaultInsert);
    fireEvent.click(root.querySelector("button")!);
    expect(picker).toBeDefined();
    expect(defaultInsert).not.toHaveBeenCalled();
    expect(insertHtml).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    window.getSelection()!.removeAllRanges();
    picker!.insert("candidate.name");
    expect(insertHtml).not.toHaveBeenCalled();
    picker!.insert("candidate.temporaryNo");
    const barcode = surface.querySelector<HTMLImageElement>('img[data-template-object-type="barcode"]')!;
    expect(barcode.dataset.templateObjectSource).toBe("candidate.temporaryNo");
    expect(barcode.parentElement?.firstChild?.textContent).toBe("앞");
    expect(barcode.parentElement?.lastChild?.textContent).toBe("뒤");
    expect(barcode.src).toMatch(/^data:image\/svg\+xml/);
    expect(insertHtml).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    dispose();
    picker!.insert("candidate.examNo");
    expect(insertHtml).toHaveBeenCalledTimes(1);
  });
});
