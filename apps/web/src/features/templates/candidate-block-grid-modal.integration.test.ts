// @vitest-environment jsdom

import { fireEvent } from "@testing-library/react";
import { mountTemplateEditor } from "examlist-template-editor";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelCandidateBlockFocusEditor,
  closeCandidateBlockFocusEditor,
  isCandidateBlockFocusEditorOpen,
  openCandidateBlockFocusEditor,
} from "examlist-template-editor/examlist/template-editor/candidate-block-grid-focus-editor";

describe("ExamList candidate block focus editor", () => {
  afterEach(() => {
    closeCandidateBlockFocusEditor();
    Reflect.deleteProperty(document, "execCommand");
    document.body.replaceChildren();
  });

  it("실제 데이터 블록의 너비와 높이를 모달 편집 영역에 그대로 반영하고 원본에 저장한다", async () => {
    const page = document.createElement("div");
    page.className = "template-editor-page";
    page.innerHTML = `
      <div class="editor-document-surface" data-template-editor-runtime-surface contenteditable="true">
        <div class="template-doc">
          <div data-candidate-block-grid>
            <div class="examlist-candidate-block is-candidate-block-template-source"
              data-candidate-block-instance="1" data-candidate-block-template-role="source"><p>기존</p></div>
          </div>
        </div>
      </div>
    `;
    document.body.append(page);
    const surface = page.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const block = page.querySelector<HTMLElement>("[data-candidate-block-template-role='source']")!;
    page.getBoundingClientRect = () =>
      ({
        left: 200,
        top: 80,
        right: 1000,
        bottom: 700,
        width: 800,
        height: 620,
        x: 200,
        y: 80,
        toJSON() {},
      }) as DOMRect;
    surface.getBoundingClientRect = page.getBoundingClientRect;
    block.getBoundingClientRect = () =>
      ({
        left: 220,
        top: 120,
        right: 934,
        bottom: 138,
        width: 714,
        height: 18,
        x: 220,
        y: 120,
        toJSON() {},
      }) as DOMRect;
    Object.defineProperties(block, {
      offsetHeight: { value: 18 },
      offsetWidth: { value: 714 },
    });
    const selectedPage = {
      id: "page-1",
      settings: {
        candidateBlockGrid: {
          enabled: true,
          blockTemplateHtml: "<p>기존</p>",
          emptyBlockLayer: { enabled: false, templateHtml: "<p><br></p>" },
          columnNameRow: { enabled: false, heightPt: 20, templateHtml: "<p><br></p>" },
        },
      },
    };
    const editor = {
      state: { templateEditor: {} },
      sync: vi.fn(),
      updateImageSelectionOverlay: vi.fn(),
      updateTableObjectOverlay: vi.fn(),
    };
    const onDirty = vi.fn();

    expect(
      openCandidateBlockFocusEditor({ blockElement: block, editor, onDirty, selectedPage, surfaceElement: surface }),
    ).toBe(true);
    const modalSurface = document.querySelector<HTMLElement>("[data-candidate-block-modal-editor-surface]")!;

    expect(modalSurface).toBeTruthy();
    expect(modalSurface.dataset.candidateBlockLogicalWidth).toBe("714");
    expect(modalSurface.dataset.candidateBlockLogicalHeight).toBe("18");
    expect(document.documentElement.style.getPropertyValue("--examlist-candidate-block-focus-editor-width")).toBe(
      "714px",
    );
    expect(document.documentElement.style.getPropertyValue("--examlist-candidate-block-focus-editor-height")).toBe(
      "18px",
    );

    modalSurface.classList.add("is-runtime-measuring");
    modalSurface.style.width = "714px";
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(onDirty).not.toHaveBeenCalled();

    modalSurface.innerHTML = "<p>취소할 수정</p>";
    fireEvent.input(modalSurface, { inputType: "insertText" });
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(block.innerHTML).toContain("기존");
    expect(selectedPage.settings.candidateBlockGrid.blockTemplateHtml).toContain("기존");
    expect(onDirty).not.toHaveBeenCalled();
    expect(cancelCandidateBlockFocusEditor()).toBe(true);
    expect(block.innerHTML).toContain("기존");
    expect(selectedPage.settings.candidateBlockGrid.blockTemplateHtml).toContain("기존");
    expect(onDirty).not.toHaveBeenCalled();

    expect(
      openCandidateBlockFocusEditor({ blockElement: block, editor, onDirty, selectedPage, surfaceElement: surface }),
    ).toBe(true);
    const reopenedSurface = document.querySelector<HTMLElement>("[data-candidate-block-modal-editor-surface]")!;
    reopenedSurface.innerHTML = "<p>적용할 수정</p>";
    fireEvent.input(reopenedSurface, { inputType: "insertText" });
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(block.innerHTML).toContain("기존");
    expect(closeCandidateBlockFocusEditor()).toBe(true);
    expect(block.innerHTML).toContain("적용할 수정");
    expect(selectedPage.settings.candidateBlockGrid.blockTemplateHtml).toContain("적용할 수정");
    expect(onDirty).toHaveBeenCalledTimes(1);
  });

  it("데이터·빈 값·컬럼명 항목을 ExamList와 같은 크기와 저장 규칙으로 전환한다", async () => {
    const page = document.createElement("div");
    page.className = "template-editor-page";
    page.innerHTML = `
      <div class="editor-document-surface" data-template-editor-runtime-surface contenteditable="true">
        <div class="template-doc">
          <div data-candidate-block-grid>
            <div class="examlist-candidate-block is-candidate-block-template-source"
              data-candidate-block-instance="1" data-candidate-block-template-role="source"><p>데이터 내용</p></div>
          </div>
        </div>
      </div>
    `;
    document.body.append(page);
    const surface = page.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const block = page.querySelector<HTMLElement>("[data-candidate-block-template-role='source']")!;
    page.getBoundingClientRect = () =>
      ({ left: 80, top: 40, right: 980, bottom: 740, width: 900, height: 700, x: 80, y: 40, toJSON() {} }) as DOMRect;
    surface.getBoundingClientRect = page.getBoundingClientRect;
    block.getBoundingClientRect = () =>
      ({
        left: 120,
        top: 100,
        right: 600,
        bottom: 196,
        width: 480,
        height: 96,
        x: 120,
        y: 100,
        toJSON() {},
      }) as DOMRect;
    Object.defineProperties(block, {
      offsetHeight: { value: 96 },
      offsetWidth: { value: 480 },
    });
    const selectedPage = {
      id: "page-1",
      settings: {
        candidateBlockGrid: {
          enabled: true,
          blockTemplateHtml: "<p>데이터 내용</p>",
          emptyBlockLayer: { enabled: false, templateHtml: "<p>빈 값 내용</p>" },
          columnNameRow: { enabled: false, heightPt: 24, templateHtml: "<p>컬럼명 내용</p>" },
        },
      },
    };
    const editor = {
      state: { templateEditor: {} },
      sync: vi.fn(),
      updateImageSelectionOverlay: vi.fn(),
      updateTableObjectOverlay: vi.fn(),
    };

    expect(
      openCandidateBlockFocusEditor({
        blockElement: block,
        editor,
        onDirty: vi.fn(),
        selectedPage,
        surfaceElement: surface,
      }),
    ).toBe(true);

    const getActiveSurface = () => page.querySelector<HTMLElement>("[data-candidate-block-modal-editor-surface]")!;
    const emptyTab = page.querySelector<HTMLButtonElement>("[data-candidate-block-focus-tab='emptyBlock']")!;
    const columnTab = page.querySelector<HTMLButtonElement>("[data-candidate-block-focus-tab='columnName']")!;

    expect(getActiveSurface().dataset.candidateBlockEditorSurfaceId).toBe("dataBlock");
    expect(getActiveSurface().dataset.candidateBlockLogicalWidth).toBe("480");
    expect(getActiveSurface().dataset.candidateBlockLogicalHeight).toBe("96");

    fireEvent.pointerDown(emptyTab);
    expect(getActiveSurface().dataset.candidateBlockEditorSurfaceId).toBe("emptyBlock");
    expect(getActiveSurface().dataset.candidateBlockLogicalHeight).toBe("96");
    expect(getActiveSurface()).toHaveAttribute("contenteditable", "false");
    const emptySwitch = page.querySelector<HTMLInputElement>("[data-candidate-block-feature-switch='emptyBlock']")!;
    fireEvent.click(emptySwitch);
    expect(selectedPage.settings.candidateBlockGrid.emptyBlockLayer.enabled).toBe(false);
    expect(getActiveSurface()).toHaveAttribute("contenteditable", "true");
    expect(getActiveSurface().innerHTML).toContain("빈 값 내용");
    getActiveSurface().innerHTML = "<p>빈 값 수정</p>";
    fireEvent.input(getActiveSurface(), { inputType: "insertText" });

    fireEvent.pointerDown(columnTab);
    expect(selectedPage.settings.candidateBlockGrid.emptyBlockLayer.templateHtml).toContain("빈 값 내용");
    expect(getActiveSurface().dataset.candidateBlockEditorSurfaceId).toBe("columnName");
    expect(getActiveSurface().dataset.candidateBlockLogicalHeight).toBe("32");
    expect(document.documentElement.style.getPropertyValue("--examlist-candidate-block-focus-editor-height")).toBe(
      "32px",
    );
    expect(
      document.documentElement.style.getPropertyValue("--examlist-candidate-block-focus-data-preview-height"),
    ).toBe("96px");
    expect(getActiveSurface()).toHaveAttribute("contenteditable", "false");
    const columnSwitch = page.querySelector<HTMLInputElement>("[data-candidate-block-feature-switch='columnName']")!;
    const columnHeightInput = page.querySelector<HTMLInputElement>("[data-candidate-block-column-name-row-height-px]")!;
    expect(columnHeightInput).toBeDisabled();
    fireEvent.click(columnSwitch);
    expect(selectedPage.settings.candidateBlockGrid.columnNameRow.enabled).toBe(false);
    expect(getActiveSurface()).toHaveAttribute("contenteditable", "true");
    expect(columnHeightInput).toBeEnabled();
    expect(columnHeightInput).toHaveValue(32);
    fireEvent.change(columnHeightInput, { target: { value: "40" } });
    expect(getActiveSurface().dataset.candidateBlockLogicalHeight).toBe("40");
    expect(document.documentElement.style.getPropertyValue("--examlist-candidate-block-focus-editor-height")).toBe(
      "40px",
    );
    expect(getActiveSurface().innerHTML).toContain("컬럼명 내용");
    getActiveSurface().innerHTML = "<p>컬럼명 수정</p>";
    fireEvent.input(getActiveSurface(), { inputType: "insertText" });

    expect(closeCandidateBlockFocusEditor()).toBe(true);
    expect(selectedPage.settings.candidateBlockGrid.emptyBlockLayer.enabled).toBe(true);
    expect(selectedPage.settings.candidateBlockGrid.emptyBlockLayer.templateHtml).toContain("빈 값 수정");
    expect(selectedPage.settings.candidateBlockGrid.columnNameRow.enabled).toBe(true);
    expect(selectedPage.settings.candidateBlockGrid.columnNameRow.templateHtml).toContain("컬럼명 수정");
  });

  it("데이터블록 모달에서도 서식과 표·이미지·바코드·QR 삽입을 활성 편집 영역에 적용한다", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const onChange = vi.fn();
    let syncPending = false;
    const onDirty = vi.fn(() => {
      if (syncPending) return;
      syncPending = true;
      queueMicrotask(() => {
        syncPending = false;
        if (!isCandidateBlockFocusEditorOpen()) editor.sync();
      });
    });
    const editor: ReturnType<typeof mountTemplateEditor> = mountTemplateEditor({
      root,
      initialHtml: `
        <div class="template-doc">
          <div data-candidate-block-grid>
            <div class="examlist-candidate-block is-candidate-block-template-source"
              data-candidate-block-instance="1" data-candidate-block-template-role="source"><p>서식 테스트</p></div>
            <div class="examlist-candidate-block"
              data-candidate-block-instance="2" data-candidate-block-template-role="replica"><p>복제 블록</p></div>
          </div>
        </div>
      `,
      permissions: { canManageTemplates: true },
      onChange,
    });
    const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
    const block = root.querySelector<HTMLElement>("[data-candidate-block-template-role='source']")!;
    surface.getBoundingClientRect = () =>
      ({ left: 100, top: 60, right: 900, bottom: 760, width: 800, height: 700, x: 100, y: 60, toJSON() {} }) as DOMRect;
    block.getBoundingClientRect = () =>
      ({
        left: 120,
        top: 100,
        right: 820,
        bottom: 500,
        width: 700,
        height: 400,
        x: 120,
        y: 100,
        toJSON() {},
      }) as DOMRect;
    Object.defineProperties(block, {
      offsetHeight: { configurable: true, value: 400 },
      offsetWidth: { configurable: true, value: 700 },
    });
    const selectedPage = {
      id: "page-1",
      settings: {
        candidateBlockGrid: {
          enabled: true,
          blockTemplateHtml: "<p>서식 테스트</p>",
          emptyBlockLayer: { enabled: false, templateHtml: "<p><br></p>" },
          columnNameRow: { enabled: false, heightPt: 20, templateHtml: "<p><br></p>" },
        },
      },
    };
    expect(
      openCandidateBlockFocusEditor({
        blockElement: block,
        editor: editor.getRuntime(),
        onDirty,
        selectedPage,
        surfaceElement: surface,
      }),
    ).toBe(true);
    const modalSurface = root.querySelector<HTMLElement>("[data-candidate-block-modal-editor-surface]")!;
    expect(modalSurface).toHaveAttribute("data-template-editor-runtime-active-surface", "true");
    expect(editor.getRuntime().state.templateEditor?.candidateBlockModalEditorController).toBeTruthy();

    const paragraph = modalSurface.querySelector("p")!;
    modalSurface.focus();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const execCommand = vi.fn((_command: string, _showUi?: boolean, _value?: string | null) => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    ["bold", "italic", "underline", "justifyCenter"].forEach((command) => {
      const commandButton = root.querySelector<HTMLElement>(`[data-template-command='${command}']`)!;
      expect(fireEvent.pointerDown(commandButton)).toBe(false);
      fireEvent.click(commandButton);
      const activeRange = selection.rangeCount ? selection.getRangeAt(0) : null;
      expect(activeRange && modalSurface.contains(activeRange.commonAncestorContainer)).toBe(true);
    });
    expect(execCommand.mock.calls.map(([command]) => command)).toEqual(
      expect.arrayContaining(["bold", "italic", "underline", "justifyCenter"]),
    );

    const imageInput = root.querySelector<HTMLInputElement>("input.upload-file-input[type='file']")!;
    const imageFile = new File([new Uint8Array([137, 80, 78, 71])], "modal-test.png", { type: "image/png" });
    fireEvent.click(root.querySelector<HTMLElement>("[data-template-open-image]")!);
    fireEvent.change(imageInput, { target: { files: [imageFile] } });
    await vi.waitFor(() => expect(modalSurface.querySelector("img[alt='modal-test.png']")).toBeTruthy(), {
      timeout: 3_000,
    });

    fireEvent.click(root.querySelector<HTMLElement>("[data-template-insert='barcode']")!);
    fireEvent.click(root.querySelector<HTMLElement>("[data-template-insert='qrcode']")!);
    expect(modalSurface.querySelector("[data-template-object-type='barcode']")).toBeTruthy();
    expect(modalSurface.querySelector("[data-template-object-type='qrcode']")).toBeTruthy();

    const tableInsertButton = root.querySelector<HTMLElement>("[data-template-insert='table']")!;
    expect(fireEvent.pointerDown(tableInsertButton)).toBe(false);
    fireEvent.click(tableInsertButton);
    // The package must also recognize the live modal DOM when a host/browser
    // realm does not expose the optional global modal bridge.
    const windowRecord = window as unknown as Record<string, unknown>;
    const modalBridge = windowRecord.ExamListCandidateBlockModalEditor;
    delete windowRecord.ExamListCandidateBlockModalEditor;
    const tableInputs = root.querySelectorAll<HTMLInputElement>(".template-table-insert-panel input[type='number']");
    const dirtyCallsBeforeTableConfig = onDirty.mock.calls.length;
    fireEvent.input(tableInputs[0]!, { target: { value: "4" } });
    fireEvent.input(tableInputs[1]!, { target: { value: "3" } });
    fireEvent.keyDown(tableInputs[0]!, { key: "ArrowUp" });
    fireEvent.input(tableInputs[0]!, { target: { value: "5" } });
    fireEvent.keyDown(tableInputs[1]!, { key: "ArrowDown" });
    fireEvent.input(tableInputs[1]!, { target: { value: "2" } });
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(document.querySelector("[data-candidate-block-focus-layer]")).toBeTruthy();
    expect(modalSurface).toHaveAttribute("data-template-editor-runtime-active-surface", "true");
    expect(onDirty).toHaveBeenCalledTimes(dirtyCallsBeforeTableConfig);
    fireEvent.change(tableInputs[0]!, { target: { value: "2" } });
    fireEvent.change(tableInputs[1]!, { target: { value: "2" } });
    fireEvent.keyDown(tableInputs[0]!, { key: "Enter" });
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(modalSurface.querySelectorAll("table tr")).toHaveLength(2);
    expect(modalSurface.querySelectorAll("table td")).toHaveLength(4);
    expect(root.querySelector("[data-candidate-block-instance='2'] table")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    windowRecord.ExamListCandidateBlockModalEditor = modalBridge;

    const focusLayer = root.querySelector<HTMLElement>("[data-candidate-block-focus-layer]")!;
    focusLayer.remove();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(root.querySelector("[data-candidate-block-focus-layer]")).toBe(focusLayer);

    const firstCell = modalSurface.querySelector<HTMLTableCellElement>("table td")!;
    firstCell.textContent = "셀";
    const cellRange = document.createRange();
    cellRange.selectNodeContents(firstCell);
    selection.removeAllRanges();
    selection.addRange(cellRange);
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    const runtime = editor.getRuntime() as ReturnType<typeof editor.getRuntime> & {
      updateTemplateEditorActiveCell?(): void;
      updateTemplateTableControls?(): void;
    };
    runtime.updateTemplateEditorActiveCell?.();
    runtime.updateTemplateTableControls?.();
    const tableToolbar = root.querySelector<HTMLElement>("[data-editor-table-toolbar-group]")!;
    const insertRowAfter = root.querySelector<HTMLButtonElement>("[data-template-table-action='insert-row-after']")!;
    expect(tableToolbar).toHaveAttribute("aria-disabled", "false");
    expect(insertRowAfter).toBeEnabled();
    fireEvent.click(insertRowAfter);
    expect(modalSurface.querySelectorAll("table tr")).toHaveLength(3);

    expect(modalSurface).toHaveAttribute("data-template-editor-runtime-active-surface", "true");

    expect(closeCandidateBlockFocusEditor()).toBe(true);
    await Promise.resolve();
    expect(editor.getRuntime().state.templateEditor?.candidateBlockModalEditorController).toBeUndefined();
    const serializedDocument = String(onChange.mock.lastCall?.[0] || "");
    expect(serializedDocument).toContain("data-candidate-block-grid");
    expect(serializedDocument).not.toContain("data-candidate-block-focus-layer");
    expect(block.innerHTML).toContain('data-template-object-type="barcode"');
    expect(block.innerHTML).toContain('data-template-object-type="qrcode"');
    expect(block.querySelector("table")).toBeTruthy();
    expect(block.querySelector("img[alt='modal-test.png']")).toBeTruthy();
    editor.destroy();
  }, 30_000);
});
