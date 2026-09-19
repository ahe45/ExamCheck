import { expect, test, type Locator, type Page } from "@playwright/test";

const tableHtml =
  '<table style="width:300px;height:80px"><colgroup><col style="width:70px"><col style="width:90px"><col style="width:140px"></colgroup><tbody><tr style="height:30px"><td colspan="2" style="background-color:#fff0c8;font-weight:bold">복사할 표</td><td><span class="template-token" contenteditable="false" data-template-token="true" data-template-tag-value="candidate.name" style="font-size:16pt;color:#cc0000;font-weight:bold">이름</span></td></tr><tr style="height:50px"><td>첫째</td><td>둘째</td><td>셋째</td></tr></tbody></table>';

async function openFixture(page: Page) {
  await page.route("**/api/v1/**", (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path.startsWith("/api/v1/form-templates/admin/"))
      return route.fulfill({
        json: templateResponse(path, [
          {
            id: 99998,
            code: "QA_CLIPBOARD",
            name: "표 복사 검증",
            category: "문서",
            usageScope: "CANDIDATE",
            active: true,
            layout: {
              id: "clipboard-template",
              name: "표 복사 검증",
              layout: {
                pages: [
                  {
                    id: "clipboard-page",
                    type: "content",
                    settings: {
                      documentHtml:
                        '<div class="template-doc"><p>앞 문단</p>' + tableHtml + "<p>붙여넣을 위치</p></div>",
                    },
                  },
                ],
              },
            },
          },
        ]),
      });
    if (request.method() === "GET" || path.endsWith("/auth/login")) return route.continue();
    return route.fulfill({ status: 409, json: { message: "Test writes disabled" } });
  });
  await page.goto("/");
  await page.getByLabel("아이디").fill("admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await page.goto("/admin/templates");
  await page.locator(".exam-template-card").first().getByRole("button", { name: "수정", exact: true }).click();
  return page.locator("[data-template-editor-runtime-surface]");
}

async function copyTable(page: Page, table: Locator) {
  const box = await table.boundingBox();
  if (!box) throw new Error("표를 찾을 수 없습니다.");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height + 2);
  await expect(table).toHaveClass(/is-selected-table-object/);
  await page.keyboard.press("Control+c");
  await expect(page.locator(".toast-message")).toHaveText("표를 복사했습니다.");
}

async function presentation(table: Locator) {
  return table.evaluate((element) => {
    const appearance = (el: Element) => {
      const style = getComputedStyle(el);
      return [
        "fontFamily",
        "fontSize",
        "fontWeight",
        "fontStyle",
        "color",
        "backgroundColor",
        "textAlign",
        "verticalAlign",
      ].map((key) => style[key as keyof CSSStyleDeclaration]);
    };
    return {
      width: (element as HTMLElement).style.width,
      height: (element as HTMLElement).style.height,
      columns: [...element.querySelectorAll("col")].map((col) => col.style.width),
      rows: [...element.querySelectorAll("tr")].map((row) => row.style.height),
      cells: [...element.querySelectorAll("td")].map((cell) => ({
        text: cell.textContent,
        colspan: cell.colSpan,
        rowspan: cell.rowSpan,
        style: appearance(cell),
      })),
      tags: [...element.querySelectorAll("[data-template-tag-value]")].map((tag) => ({
        tag: tag.getAttribute("data-template-tag-value"),
        style: appearance(tag),
      })),
    };
  });
}

test("표 개체 복사: 다른 위치 붙여넣기, 서식·병합·태그 유지, 실행 취소", async ({ page }) => {
  const surface = await openFixture(page);
  const tables = surface.locator(".template-doc > table");
  const original = await presentation(tables.first());
  await copyTable(page, tables.first());
  await surface.locator(".template-doc > p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+v");
  await expect(tables).toHaveCount(2);
  expect(await presentation(tables.nth(1))).toEqual(original);
  await page.keyboard.press("Control+z");
  await expect(tables).toHaveCount(1);
  await page.keyboard.press("Control+y");
  await expect(tables).toHaveCount(2);
  expect(await presentation(tables.nth(1))).toEqual(original);

  // Object copy also works with no text caret, and does not replace the source.
  await copyTable(page, tables.last());
  await page.keyboard.press("Control+v");
  await expect(tables).toHaveCount(3);
  expect(await presentation(tables.last())).toEqual(original);

  // Normal text selection continues to use native clipboard behavior.
  const paragraph = surface.locator(".template-doc > p").first();
  await paragraph.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Control+c");
  const textDestination = surface.locator(".template-doc > p").filter({ hasText: "붙여넣을 위치" }).first();
  await textDestination.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Control+v");
  await expect(tables).toHaveCount(3);
  await expect(textDestination).toContainText("앞 문단");
});

test("표 개체 복사: 캔버스와 데이터 블록 편집 모달 사이 붙여넣기", async ({ page }) => {
  const surface = await openFixture(page);
  const canvasTables = surface.locator(".template-doc > table");
  const original = await presentation(canvasTables.first());
  await copyTable(page, canvasTables.first());
  const rows = page.locator('[data-examlist-block-grid-setting="rows"]');
  await rows.fill("2");
  await rows.press("Tab");
  await page.locator("[data-examlist-block-grid-create]").click();
  const grid = surface.locator("[data-candidate-block-grid]");
  await expect(grid).toHaveAttribute("data-candidate-block-rows", "2");
  const gridBox = await grid.boundingBox();
  await page.mouse.click(gridBox!.x + 1, gridBox!.y + gridBox!.height / 2);
  const resize = await grid.locator('[data-candidate-block-grid-resize-corner="bottom"]').boundingBox();
  await page.mouse.move(resize!.x + resize!.width / 2, resize!.y + resize!.height / 2);
  await page.mouse.down();
  await page.mouse.move(resize!.x + resize!.width / 2, resize!.y + resize!.height / 2 + 220, { steps: 5 });
  await page.mouse.up();
  const source = surface.locator('[data-candidate-block-template-role="source"]').first();
  await source.click();
  const dialog = page.getByRole("dialog", { name: "데이터 블록 편집" });
  const modal = dialog.locator("[data-candidate-block-modal-editor-surface]");
  await modal.fill("");
  await page.keyboard.press("Control+v");
  await expect(modal.locator("table")).toHaveCount(1);
  expect(await presentation(modal.locator("table"))).toEqual(original);
  await dialog.getByRole("button", { name: "적용", exact: true }).click();
  await expect(source.locator("table")).toHaveCount(1);
  await source.click();
  expect(await presentation(modal.locator("table"))).toEqual(original);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("이전 클립보드 내용"));
  await copyTable(page, modal.locator("table"));
  const copiedHtml = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find((item) => item.types.includes("text/html"));
    return item ? (await item.getType("text/html")).text() : "";
  });
  expect(copiedHtml).toContain('data-template-table-clipboard="true"');
  expect(copiedHtml).toContain("복사할 표");
  expect(copiedHtml).not.toContain("이전 클립보드 내용");
  await dialog.getByRole("tab", { name: "컬럼명", exact: true }).click();
  await dialog.locator('[data-candidate-block-feature-switch="columnName"]').check();
  const headerHeight = dialog.locator("[data-candidate-block-column-name-row-height-px]");
  await headerHeight.fill("100");
  await headerHeight.press("Enter");
  await modal.fill("");
  await page.keyboard.press("Control+v");
  await expect(modal.locator("table")).toHaveCount(1);
  expect(await presentation(modal.locator("table"))).toEqual(original);
  await dialog.getByRole("tab", { name: "데이터 블록", exact: true }).click();
  expect(await presentation(modal.locator("table"))).toEqual(original);
  await copyTable(page, modal.locator("table"));
  await dialog.getByRole("button", { name: "적용", exact: true }).click();
  await surface.locator(".template-doc > p").last().click();
  await page.keyboard.press("Control+v");
  await expect(canvasTables).toHaveCount(2);
  expect(await presentation(canvasTables.last())).toEqual(original);
});

test("표 개체 복사: 공간이 부족하면 원본 크기를 훼손하지 않고 안내한다", async ({ page }) => {
  const surface = await openFixture(page);
  const table = surface.locator(".template-doc > table");
  const original = await presentation(table);
  await copyTable(page, table);
  await page.locator("[data-examlist-block-grid-create]").click();
  await surface.locator('[data-candidate-block-template-role="source"]').first().click();
  const dialog = page.getByRole("dialog", { name: "데이터 블록 편집" });
  const modal = dialog.locator("[data-candidate-block-modal-editor-surface]");
  await modal.fill("");
  await page.keyboard.press("Control+v");
  await expect(modal.locator("table")).toHaveCount(0);
  await expect(page.locator(".toast-message").filter({ hasText: "표를 붙여넣을 공간이 부족합니다." })).toBeVisible();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  expect(await presentation(table)).toEqual(original);
});

async function selectCells(page: Page, table: Locator, start: number, end: number) {
  const cells = table.locator("td, th");
  const first = await cells.nth(start).boundingBox();
  const last = await cells.nth(end).boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(last!.x + last!.width / 2, last!.y + last!.height / 2, { steps: 8 });
  await page.mouse.up();
}

test("셀 내용 삭제: 선택한 셀만 비우고 표 구조·서식 및 실행 취소를 유지한다", async ({ page }) => {
  const surface = await openFixture(page);
  const table = surface.locator(".template-doc > table");
  const original = await presentation(table);
  await selectCells(page, table, 2, 3);
  await expect(table.locator(".is-selected-cell")).toHaveCount(2);
  await page.keyboard.press("Delete");
  await expect(table).toHaveCount(1);
  const cleared = await presentation(table);
  expect(cleared).toEqual({
    ...original,
    cells: original.cells.map((cell, index) => (index === 2 || index === 3 ? { ...cell, text: "" } : cell)),
  });
  await page.keyboard.press("Control+z");
  await expect.poll(() => presentation(table)).toEqual(original);
  await page.keyboard.press("Control+y");
  await expect.poll(() => presentation(table)).toEqual(cleared);
});

for (const key of ["Delete", "Backspace"]) {
  test("셀 내용 삭제: 데이터 블록 모달의 전체 셀 선택 (" + key + ")", async ({ page }) => {
    const surface = await openFixture(page);
    const canvasTable = surface.locator(".template-doc > table");
    await copyTable(page, canvasTable);
    const rows = page.locator('[data-examlist-block-grid-setting="rows"]');
    await rows.fill("2");
    await rows.press("Tab");
    await page.locator("[data-examlist-block-grid-create]").click();
    const grid = surface.locator("[data-candidate-block-grid]");
    const box = await grid.boundingBox();
    await page.mouse.click(box!.x + 1, box!.y + box!.height / 2);
    const resize = await grid.locator('[data-candidate-block-grid-resize-corner="bottom"]').boundingBox();
    await page.mouse.move(resize!.x + resize!.width / 2, resize!.y + resize!.height / 2);
    await page.mouse.down();
    await page.mouse.move(resize!.x + resize!.width / 2, resize!.y + resize!.height / 2 + 220, { steps: 5 });
    await page.mouse.up();
    const source = surface.locator('[data-candidate-block-template-role="source"]').first();
    await source.click();
    const dialog = page.getByRole("dialog", { name: "데이터 블록 편집" });
    const modal = dialog.locator("[data-candidate-block-modal-editor-surface]");
    await modal.fill("");
    await page.keyboard.press("Control+v");
    const table = modal.locator("table");
    await expect(table).toHaveCount(1);
    const original = await presentation(table);
    await selectCells(page, table, 0, 4);
    await expect(table.locator(".is-selected-cell")).toHaveCount(5);
    await page.keyboard.press(key);
    await expect(table).toHaveCount(1);
    await table.locator("td").first().click();
    const cleared = { ...original, cells: original.cells.map((cell) => ({ ...cell, text: "" })), tags: [] };
    await expect.poll(() => presentation(table)).toEqual(cleared);
    await page.keyboard.press("Control+z");
    await expect.poll(() => presentation(table)).toEqual(original);
    await page.keyboard.press("Control+y");
    await expect.poll(() => presentation(table)).toEqual(cleared);
    await dialog.getByRole("button", { name: "적용", exact: true }).click();
    await source.click();
    await expect.poll(() => presentation(table)).toEqual(cleared);
    // Object selection retains its explicit whole-table deletion behavior.
    const tableBox = await table.boundingBox();
    await page.mouse.click(tableBox!.x + tableBox!.width / 2, tableBox!.y + tableBox!.height + 2);
    await expect(table).toHaveClass(/is-selected-table-object/);
    await page.keyboard.press(key);
    await expect(table).toHaveCount(0);
  });
}

test("용지 하단 표 뒤의 빈 커서 줄은 초과로 계산하지 않고 실제 내용은 감지한다", async ({ page }) => {
  await page.route("**/examlist-template-editor-adapter.ts", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      "const mounted = mount(options);",
      "const mounted = mount(options); globalThis.__qaEditor = mounted;",
    );
    await route.fulfill({ response, body });
  });
  const surface = await openFixture(page);
  const prepare = async (tail: string, tableOverflow = 0) => {
    await surface.evaluate(
      (element, args) => {
        const editor = (
          globalThis as typeof globalThis & {
            __qaEditor: { getRuntime(): { setHtml(html: string): void; sync(): void } };
          }
        ).__qaEditor;
        editor.getRuntime().setHtml('<div class="template-doc"><p><br></p></div>');
        const height = element.querySelector(".template-doc")!.getBoundingClientRect().height;
        const table =
          '<table style="width:300px;height:80px;position:absolute;left:0;top:' +
          (height - 83 + args.tableOverflow) +
          'px"><tbody><tr style="height:80px"><td>용지 하단 표</td></tr></tbody></table>';
        editor.getRuntime().setHtml('<div class="template-doc">' + table + args.tail + "</div>");
        editor.getRuntime().sync();
      },
      { tail, tableOverflow },
    );
  };
  const overflow = () =>
    page.evaluate(() => {
      const editor = (
        globalThis as typeof globalThis & {
          __qaEditor: {
            getOverflowInfo(): { hasOverflow: boolean };
            getRuntime(): { state: { templateEditor: { hasOverflow: boolean } } };
          };
        }
      ).__qaEditor;
      return {
        public: editor.getOverflowInfo().hasOverflow,
        runtime: editor.getRuntime().state.templateEditor.hasOverflow,
      };
    });
  await prepare("<p><br></p>");
  await expect.poll(overflow).toEqual({ public: false, runtime: false });
  await prepare('<p><span style="font-weight:bold"><br></span></p>');
  await expect.poll(overflow).toEqual({ public: false, runtime: false });
  await prepare("<p>표 뒤 실제 내용</p>");
  await expect.poll(overflow).toEqual({ public: true, runtime: true });
  await prepare("<p><br></p>", 25);
  await expect.poll(overflow).toEqual({ public: true, runtime: true });
});

test("문장 중간에 연속 입력해도 커서가 캔버스 끝으로 이동하지 않는다", async ({ page }) => {
  const surface = await openFixture(page);
  const first = surface.locator(".template-doc > p").first();
  await first.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("ABC", { delay: 80 });
  await expect(first).toHaveText("앞ABC 문단");
  await expect(surface.locator(".template-doc > p").last()).toHaveText("붙여넣을 위치");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("D");
  await expect(first).toHaveText("앞ABD 문단");
});

test("표 셀과 데이터 태그 뒤에서 입력 위치가 유지된다", async ({ page }) => {
  const surface = await openFixture(page);
  const cell = surface.locator(".template-doc > table td").nth(2);
  await cell.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("ABC", { delay: 60 });
  await expect(cell).toHaveText("첫ABC째");
  const tokenCell = surface.locator(".template-doc > table td").nth(1);
  const tagLabel = await tokenCell.locator("[data-template-tag-value]").innerText();
  await tokenCell.evaluate((cell) => {
    const surface = cell.closest<HTMLElement>("[data-template-editor-runtime-surface]")!;
    surface.focus();
    const range = document.createRange();
    range.setStartAfter(cell.querySelector("[data-template-tag-value]")!);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.type("XYZ", { delay: 60 });
  await expect(tokenCell).toContainText(tagLabel + "XYZ");
  await expect(tokenCell.locator("[data-template-tag-value]")).toHaveText(tagLabel);
  await expect(surface.locator(".template-doc > p").last()).toHaveText("붙여넣을 위치");
});

test("한글 조합 입력과 줄바꿈 후에도 원래 문단에서 편집한다", async ({ page }) => {
  const surface = await openFixture(page);
  const paragraph = surface.locator(".template-doc > p").first();
  await paragraph.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  const cdp = await page.context().newCDPSession(page);
  for (const text of ["ㅎ", "하", "한"]) {
    await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
  }
  await cdp.send("Input.insertText", { text: "한글" });
  await page.keyboard.type("ABC", { delay: 60 });
  await expect(paragraph).toHaveText("앞한글ABC 문단");
  await page.keyboard.press("Enter");
  await page.keyboard.type("DEF", { delay: 60 });
  await expect(paragraph).toHaveText("앞한글ABCDEF 문단");
  await expect(paragraph.locator("br")).toHaveCount(1);
  await expect(surface.locator(".template-doc > p").last()).toHaveText("붙여넣을 위치");
  await cdp.detach();
});

for (const location of ["문단", "표 셀"]) {
  test("작성자 한글 연속 조합 중 음절이 중복되지 않는다: " + location, async ({ page }) => {
    const surface = await openFixture(page);
    const paragraph =
      location === "문단"
        ? surface.locator(".template-doc > p").first()
        : surface.locator(".template-doc > table td").nth(2);
    const original = await paragraph.innerText();
    await paragraph.click();
    await page.keyboard.press("Home");
    const cdp = await page.context().newCDPSession(page);
    for (const [steps, final] of [
      [["ㅈ", "자", "작"], "작"],
      [["ㅅ", "서", "성"], "성"],
      [["ㅈ", "자"], "자"],
    ] as const) {
      for (const text of steps) {
        await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
        await page.waitForTimeout(40);
      }
      await cdp.send("Input.insertText", { text: final });
    }
    await expect(paragraph).toHaveText("작성자" + original);
    await page.keyboard.type(" ABC");
    await expect(paragraph).toHaveText("작성자 ABC" + original);
    await cdp.detach();
  });
}

for (const location of ["문단", "표 셀"]) {
  test("태그 삽입 후 같은 줄에서 이어 입력한다: " + location, async ({ page }) => {
    const surface = await openFixture(page);
    await page.locator("input[data-template-tag-search]").fill("이름");
    const paragraph =
      location === "문단"
        ? surface.locator(".template-doc > p").first()
        : surface.locator(".template-doc > table td").nth(2);
    await paragraph.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Backspace");
    await page
      .locator(".template-tag-button")
      .filter({ hasText: /^\s*이름\s*$/ })
      .click();
    await expect(paragraph.locator("[data-template-tag-value]")).toHaveCount(1);
    await expect(paragraph.locator("br")).toHaveCount(0);
    await page.keyboard.type("ABC", { delay: 60 });
    await expect(paragraph).toContainText("ABC");
    await expect(paragraph.locator("br")).toHaveCount(0);
  });
}

function templateResponse(path: string, records: unknown[]) {
  return path.endsWith("/summaries") ? records : records[0];
}
