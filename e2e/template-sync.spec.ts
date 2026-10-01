import { expect, test } from "@playwright/test";
import path from "node:path";

const packageRoot = "/@fs/" + path.resolve("node_modules/examlist-template-editor").replaceAll("\\", "/");

for (const zoom of [0.7, 1, 1.5]) {
  test(`셀 크기 입력은 ${zoom * 100}% 확대에서도 선택·포커스·기존 pt 여백을 유지한다`, async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(
      async ({ zoom, packageRoot }) => {
        const adapterPath = "/src/features/templates/editor/examlist-template-editor-adapter.ts";
        const { mountProjectTemplateEditor } = await import(/* @vite-ignore */ adapterPath);
        const stylesPath = packageRoot + "/src/styles/template-editor.css";
        await import(/* @vite-ignore */ stylesPath);
        const root = document.createElement("div");
        Object.assign(root.style, {
          position: "fixed",
          inset: "0",
          zIndex: "99999",
          background: "white",
          overflow: "auto",
        });
        document.body.append(root);
        const editor = mountProjectTemplateEditor({
          root,
          permissions: { canManageTemplates: true },
          initialHtml:
            '<div class="template-doc"><table style="width:320px;height:160px;table-layout:fixed;border-collapse:collapse"><colgroup><col style="width:140px"><col style="width:180px"></colgroup><tbody><tr style="height:60px"><td style="padding:2pt">가</td><td style="padding:2pt">나</td></tr><tr style="height:100px"><td style="padding:4pt">다</td><td style="padding:4pt">라</td></tr></tbody></table><p><br></p></div>',
        });
        try {
          const runtime = editor.getRuntime();
          const surface = root.querySelector<HTMLElement>("[data-template-editor-runtime-surface]")!;
          surface.style.transform = `scale(${zoom})`;
          let table = surface.querySelector<HTMLTableElement>("table")!;
          const select = (cells: HTMLTableCellElement[]) => {
            const range = document.createRange();
            range.selectNodeContents(cells[0]);
            range.collapse(true);
            surface.focus();
            window.getSelection()!.removeAllRanges();
            window.getSelection()!.addRange(range);
            const state = runtime.state.templateEditor;
            state.savedRange = range.cloneRange();
            state.savedSelectionSnapshot = null;
            state.activeCellElement = cells[0];
            state.tableSelection =
              cells.length > 1 ? { table, anchorCell: cells[0], focusCell: cells.at(-1), selectedCells: cells } : null;
            document.dispatchEvent(new Event("selectionchange"));
          };
          const settle = () =>
            new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          select([table.rows[0].cells[0]]);
          await settle();
          const input = root.querySelector<HTMLInputElement>('[data-template-cell-size-input="width"]')!;
          const before = [...table.rows].map((row) => row.getBoundingClientRect().height / zoom);
          const paddingDisplay = root.querySelector("[data-editor-cell-padding-current]")?.textContent;
          input.focus();
          input.value = "120";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          await settle();
          table = surface.querySelector<HTMLTableElement>("table")!;
          const after = [...table.rows].map((row) => row.getBoundingClientRect().height / zoom);
          const width = table.rows[0].cells[0].getBoundingClientRect().width / zoom;
          const focused = document.activeElement === input;
          select([...table.querySelectorAll<HTMLTableCellElement>("td")]);
          await settle();
          const mixed = input.placeholder;
          const padding = [...table.querySelectorAll("td")].map((cell) => cell.style.padding);
          const saved = editor.getHtml();
          runtime.setInteractionDisabled(true);
          const blocked = runtime.insertHtml("<p>차단된 입력</p>");
          const cleared = runtime.state.templateEditor.tableSelection == null;
          runtime.setInteractionDisabled(false);
          return { before, after, width, focused, mixed, padding, paddingDisplay, saved, blocked, cleared };
        } finally {
          editor.destroy();
          root.remove();
        }
      },
      { zoom, packageRoot },
    );
    expect(result.width).toBeCloseTo(120, 0);
    expect(result.after).toEqual(result.before);
    expect(result.focused).toBe(true);
    expect(result.mixed).toBe("혼합");
    expect(result.paddingDisplay).toBe("2.67");
    expect(result.padding).toEqual(["2pt", "2pt", "4pt", "4pt"]);
    expect(result.saved).toContain("padding: 2pt");
    expect(result.blocked).toBe(false);
    expect(result.cleared).toBe(true);
  });
}

test("인쇄 준비는 iframe에서도 긴 데이터를 5pt까지 맞추고 객체 아래 간격과 색상을 보존한다", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async (packageRoot) => {
    const domPath = packageRoot + "/src/dom/print-layout.js";
    const { fitTemplatePrintData } = await import(/* @vite-ignore */ domPath);
    const frame = document.createElement("iframe");
    frame.style.width = "800px";
    document.body.append(frame);
    try {
      const doc = frame.contentDocument!;
      doc.body.innerHTML = `<main class="print-document"><div class="template-doc" style="position:relative;width:700px">
        <div class="examlist-candidate-block"><table style="width:100px;table-layout:fixed;border-collapse:collapse"><tbody><tr style="height:30px"><td style="height:30px;padding:0"><span data-template-tag-value="candidate.name" style="font-size:24pt;color:rgb(200,0,0)">아주아주긴수험생이름입니다</span></td></tr></tbody></table></div>
        <table id="floating" style="position:absolute;top:120px;width:200px;height:80px"><tr><td>떠 있는 표</td></tr></table><p id="following">다음 문단</p>
      </div></main>`;
      fitTemplatePrintData(doc.body);
      const tag = doc.querySelector<HTMLElement>("[data-template-tag-value]")!;
      const computed = doc.defaultView!.getComputedStyle(tag);
      const fontSize = parseFloat(computed.fontSize);
      const spacer = doc.querySelector<HTMLElement>("[data-preview-object-flow-spacer]")!;
      const firstHeight = spacer.style.height;
      fitTemplatePrintData(doc.body);
      return {
        fontSize,
        color: computed.color,
        spacerHeight: parseFloat(spacer.style.height),
        firstHeight,
        finalHeight: spacer.style.height,
        spacerCount: doc.querySelectorAll("[data-preview-object-flow-spacer]").length,
        followingTop: doc.querySelector("#following")!.getBoundingClientRect().top,
        objectBottom: doc.querySelector("#floating")!.getBoundingClientRect().bottom,
      };
    } finally {
      frame.remove();
    }
  }, packageRoot);
  expect(result.fontSize).toBeGreaterThanOrEqual((5 * 96) / 72 - 0.01);
  expect(result.fontSize).toBeLessThan((24 * 96) / 72);
  expect(result.color).toBe("rgb(200, 0, 0)");
  expect(result.spacerHeight).toBeGreaterThanOrEqual(80);
  expect(result.followingTop).toBeGreaterThanOrEqual(result.objectBottom);
  expect(result.finalHeight).toBe(result.firstHeight);
  expect(result.spacerCount).toBe(1);
});
