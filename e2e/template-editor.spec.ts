import { expect, test, type Locator, type Page } from "@playwright/test";

test.describe("양식 편집기 핵심 실제 브라우저 흐름", () => {
  test("서명자명 입력 설정을 켜고 끈 상태가 저장과 새로고침 후 유지된다", async ({ page }) => {
    const html =
      '<div class="template-doc"><p><span class="template-token" contenteditable="false" data-template-tag-value="signature.author">작성자</span></p></div>';
    let record = {
      id: 99995,
      code: "QA_SIGNATURE_SETTING",
      name: "서명자 설정 검증",
      category: "문서",
      usageScope: "CANDIDATE",
      active: true,
      layout: {
        id: "signature-template",
        name: "서명자 설정 검증",
        layout: {
          pages: [
            {
              id: "signature-page",
              type: "content",
              settings: { documentHtml: html, signatureNames: { enabled: false } },
            },
          ],
        },
      },
    };
    let saveCount = 0;
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      if (path.startsWith("/api/v1/form-templates/admin/"))
        return route.fulfill({ json: templateResponse(path, [record]) });
      if (path.endsWith("/form-templates/QA_SIGNATURE_SETTING") && request.method() === "PUT") {
        record = { ...record, ...request.postDataJSON() };
        saveCount++;
        return route.fulfill({ json: record });
      }
      if (request.method() === "GET" || path.endsWith("/auth/login")) return route.continue();
      return route.fulfill({ status: 409, json: { message: "Test writes disabled" } });
    });
    await loginAsAdmin(page);
    await page.goto("/admin/templates");
    await page.locator(".exam-template-card").first().getByRole("button", { name: "수정", exact: true }).click();
    const toggle = page.getByRole("checkbox", { name: "PDF 생성 전 서명자명 입력" });
    await expect(toggle).toBeEnabled();
    for (const enabled of [true, false, true]) {
      await toggle.setChecked(enabled, { force: true });
      const previousCount = saveCount;
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect.poll(() => saveCount).toBe(previousCount + 1);
      expect(record.layout.layout.pages[0].settings.signatureNames.enabled).toBe(enabled);
      await expect(page.getByText("서명자 설정 검증 양식을 저장했습니다.", { exact: true })).toBeVisible();
      await page.reload();
      await expect(toggle).toBeEnabled();
      await expect(toggle).toBeChecked({ checked: enabled });
    }
  });

  for (const footerTop of [1011, 1008]) {
    test(`용지 하단 표의 위치가 반복 저장과 새로고침 후에도 유지된다 (${footerTop}px)`, async ({ page }) => {
      const bodyTable =
        '<table style="width:713px;height:36px;border-collapse:collapse"><tbody><tr style="height:36px"><td style="border:1pt solid black;padding:0;height:35px;min-height:35px">수험생</td></tr></tbody></table>';
      const headerTable = bodyTable.replaceAll("36px", "33px").replace("수험생", "컬럼명");
      const blocks = Array.from(
        { length: 20 },
        (_, i) =>
          '<div class="examlist-candidate-block" data-candidate-block-instance="' +
          (i + 1) +
          '" style="grid-area:' +
          (i * 2 + 2) +
          '/1">' +
          bodyTable +
          "</div>",
      ).join("");
      let html =
        '<div class="template-doc" data-template-page-size="A4" data-template-page-margin-top="10" data-template-page-margin-bottom="10"><div style="height:154.34375px;margin-bottom:1.33333px">가번호 부여대장</div><p><br></p>' +
        '<div class="examlist-candidate-block-grid has-candidate-block-column-name-row is-candidate-block-zero-gap-x is-candidate-block-zero-gap-y" data-candidate-block-grid="true" data-candidate-block-columns="1" data-candidate-block-rows="20" data-candidate-block-column-name-row-enabled="true" data-candidate-block-column-name-row-height-pt="27" style="position:absolute;left:0;top:174px;width:716px;height:816px;grid-template-columns:1fr;grid-template-rows:36px repeat(19,minmax(20px,1fr) 0px) minmax(20px,1fr);gap:0"><div class="examlist-candidate-block examlist-candidate-block-column-name" data-candidate-block-column-name="true" style="grid-area:1/1">' +
        headerTable +
        "</div>" +
        blocks +
        '</div><p style="margin:0"><br></p>' +
        '<table style="position:absolute;top:1011px;left:0;width:716px;height:33px;border-collapse:collapse"><tbody><tr style="height:33px"><td style="height:33px;padding:0;border:1px solid black">작성자</td><td style="height:33px;padding:0;border:1px solid black">확인자</td></tr></tbody></table><p><br></p></div>';
      if (footerTop === 1008) {
        html = html
          .replace("top:174px", "top:171px")
          .replace('<p style="margin:0"><br></p>', "<p><br></p>")
          .replace("top:1011px", "top:1008px")
          .replaceAll("height:33px", "height:36px");
      }
      let record = {
        id: 99996,
        code: "QA_FOOTER_POSITION",
        name: "하단 표 위치 검증",
        category: "문서",
        usageScope: "CANDIDATE",
        active: true,
        layout: {
          id: "footer-template",
          name: "하단 표 위치 검증",
          layout: {
            pages: [
              {
                id: "footer-page",
                type: "content",
                settings: {
                  documentHtml: html,
                  editorMode: "document",
                  safeArea: { bottom: 28.35, left: 28.35, right: 28.35, top: 28.35 },
                  pageNumber: { enabled: true, position: "center", preset: "numericCurrentTotal" },
                  candidateBlockGrid: {
                    enabled: true,
                    columns: 1,
                    rows: 20,
                    widthPt: 537,
                    heightPt: 585,
                    xPt: 0,
                    yPt: footerTop === 1008 ? 128.25 : 130.5,
                    gapXPt: 0,
                    gapYPt: 0,
                    fillEmptyBlocks: false,
                    blockTemplateHtml: bodyTable,
                    columnNameRow: { enabled: true, heightPt: 27, templateHtml: headerTable },
                  },
                },
              },
            ],
          },
        },
      };
      let saveCount = 0;
      await page.route("**/api/v1/**", (route) => {
        const request = route.request(),
          path = new URL(request.url()).pathname;
        if (path.startsWith("/api/v1/form-templates/admin/"))
          return route.fulfill({ json: templateResponse(path, [record]) });
        if (request.method() === "PUT" && path.endsWith("/form-templates/QA_FOOTER_POSITION")) {
          record = { ...record, ...request.postDataJSON() };
          saveCount++;
          return route.fulfill({ json: record });
        }
        if (request.method() === "GET" || path.endsWith("/auth/login")) return route.continue();
        return route.fulfill({ status: 409, json: { message: "Test writes disabled" } });
      });
      await loginAsAdmin(page);
      await page.goto("/admin/templates");
      await page.locator(".exam-template-card").first().getByRole("button", { name: "수정", exact: true }).click();
      const footer = page.locator("[data-template-editor-runtime-surface] > .template-doc > table");
      const geometry = () =>
        footer.evaluate((table) => {
          const rect = table.getBoundingClientRect(),
            doc = table.parentElement!.getBoundingClientRect();
          return {
            top: (table as HTMLElement).style.top,
            y: rect.top - doc.top,
            height: rect.height,
            overflow: rect.bottom > doc.bottom + 1,
          };
        });
      await expect(footer).toBeVisible();
      await expect.poll(async () => (await geometry()).top).toBe(`${footerTop}px`);
      const initial = await geometry();
      expect(initial.overflow).toBe(false);
      for (let cycle = 1; cycle <= 3; cycle++) {
        await page.getByLabel("양식 제목", { exact: true }).fill(`하단 표 위치 검증 ${cycle}`);
        await page.getByRole("button", { name: "저장", exact: true }).click();
        await expect.poll(() => saveCount).toBe(cycle);
        await page.reload();
        await expect(footer).toBeVisible();
        await expect.poll(geometry).toEqual(initial);
      }
    });
  }

  test("복사한 컬럼명 표와 데이터 표가 캔버스와 인쇄에서 같은 경계로 이어진다", async ({ page }) => {
    const table = (height: number) =>
      `<table style="width:297px;height:${height}px"><colgroup><col style="width:57px"><col style="width:140px"><col style="width:100px"></colgroup><tbody><tr style="height:${height}px">${'<td style="border:1px solid black;padding:0"><br></td>'.repeat(3)}</tr></tbody></table>`;
    const header = `<div class="examlist-candidate-block examlist-candidate-block-column-name" data-candidate-block-column-name="true" data-candidate-block-grid-row="1" data-candidate-block-grid-column="1" style="grid-area:1/1">${table(33)}</div>`;
    const rows = [2, 3, 4]
      .map(
        (row) =>
          `<div class="examlist-candidate-block" data-candidate-block-instance="${row - 1}" data-candidate-block-grid-row="${row}" data-candidate-block-grid-column="1" style="grid-area:${row}/1">${table(37)}</div>`,
      )
      .join("");
    const html = `<div class="template-doc"><div class="examlist-candidate-block-grid has-candidate-block-column-name-row" data-candidate-block-grid="true" data-candidate-block-columns="1" data-candidate-block-rows="3" data-candidate-block-column-name-row-enabled="true" data-candidate-block-column-name-row-height-pt="27" style="display:grid;width:300px;height:156px;grid-template-columns:1fr;grid-template-rows:36px repeat(3,40px);gap:0">${header}${rows}</div><p><br></p></div>`;
    await page.route("**/api/v1/**", (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      if (path.startsWith("/api/v1/form-templates/admin/"))
        return route.fulfill({
          json: templateResponse(path, [
            {
              id: 99997,
              code: "QA_JOINED_HEADER",
              name: "컬럼명 표 연결",
              category: "문서",
              usageScope: "CANDIDATE",
              active: true,
              layout: {
                id: "header-template",
                name: "컬럼명 표 연결",
                layout: {
                  pages: [
                    {
                      id: "header-page",
                      type: "content",
                      settings: {
                        documentHtml: html,
                        candidateBlockGrid: {
                          enabled: true,
                          columns: 1,
                          rows: 3,
                          widthPt: 225,
                          heightPt: 90,
                          xPt: 0,
                          yPt: 0,
                          gapXPt: 0,
                          gapYPt: 0,
                          fillEmptyBlocks: true,
                          blockTemplateHtml: table(37),
                          columnNameRow: { enabled: true, heightPt: 27, templateHtml: table(33) },
                        },
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
    await loginAsAdmin(page);
    await page.goto("/admin/templates");
    await page.locator(".exam-template-card").first().getByRole("button", { name: "수정", exact: true }).click();
    const surface = page.locator("[data-template-editor-runtime-surface]");
    const measure = (root: Element) => {
      const grid = root.querySelector("[data-candidate-block-grid]")!;
      const gridRect = grid.getBoundingClientRect();
      return [...grid.querySelectorAll("table")].map((table) => {
        const rect = table.getBoundingClientRect();
        return {
          left: rect.left - gridRect.left,
          right: rect.right - gridRect.left,
          top: rect.top - gridRect.top,
          bottom: rect.bottom - gridRect.top,
          cells: [...table.rows[0].cells].map((cell) => cell.getBoundingClientRect().right - gridRect.left),
          borderTop: getComputedStyle(table.rows[0].cells[0]).borderTopWidth,
          background: getComputedStyle(table.parentElement!).backgroundColor,
        };
      });
    };
    await expect.poll(async () => (await surface.evaluate(measure))[0]?.left).toBe(0);
    const canvas = await surface.evaluate(measure);
    expect(canvas).toHaveLength(4);
    for (let index = 0; index < canvas.length; index++) {
      expect(canvas[index].left).toBe(0);
      expect(canvas[index].right).toBe(300);
      expect(canvas[index].cells).toEqual(canvas[0].cells);
      expect(canvas[index].background).toBe("rgb(255, 255, 255)");
      if (index) {
        expect(canvas[index].top).toBe(canvas[index - 1].bottom);
        expect(canvas[index].borderTop).toBe("0px");
      }
    }
    const [preview] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("button", { name: "미리보기", exact: true }).click(),
    ]);
    await preview.waitForLoadState();
    for (const media of ["screen", "print"] as const) {
      await preview.emulateMedia({ media });
      expect(await preview.locator("body").evaluate(measure)).toEqual(canvas);
    }
    await preview.close();
  });

  test("Shift 열 조절 후 기존 데이터 블록과 설정이 저장·재진입까지 유지된다", async ({ page }) => {
    const table =
      '<table style="width:713px;height:37px"><colgroup><col style="width:238px"><col style="width:238px"><col style="width:237px"></colgroup><tbody><tr style="height:37px">' +
      '<td style="border:1px solid black;height:37px"><br></td>'.repeat(3) +
      "</tr></tbody></table>";
    const blocks = Array.from(
      { length: 20 },
      (_, i) =>
        `<div class="examlist-candidate-block" data-candidate-block-instance="${i + 1}" data-candidate-block-grid-row="${i + 1}" data-candidate-block-grid-column="1" style="grid-area:${i + 1}/1">${table}</div>`,
    ).join("");
    let record = {
      id: 99999,
      code: "QA_SHIFT",
      name: "열 조절 검증",
      description: "",
      category: "문서",
      usageScope: "CANDIDATE",
      active: true,
      createdAt: "2026-01-01",
      createdByLoginId: "admin",
      layout: {
        id: "qa-template",
        name: "열 조절 검증",
        layout: {
          pages: [
            {
              id: "qa-page",
              type: "content",
              settings: {
                documentHtml:
                  '<div class="template-doc"><p>가번호 부여대장</p><div class="examlist-candidate-block-grid" data-candidate-block-grid="true" data-candidate-block-columns="1" data-candidate-block-rows="20" data-candidate-block-variant="photo" style="display:grid;width:716px;height:780px;grid-template-columns:1fr;grid-template-rows:repeat(20,minmax(20px,1fr));gap:0px">' +
                  blocks +
                  "</div><p><br></p></div>",
              } as {
                documentHtml: string;
                candidateBlockGrid?: { enabled: boolean; rows: number; columns: number; blockTemplateHtml: string };
              },
            },
          ],
        },
      },
    };
    let saved = false;
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      if (path.startsWith("/api/v1/form-templates/admin/"))
        return route.fulfill({ json: templateResponse(path, [record]) });
      if (request.method() === "PUT" && path.endsWith("/form-templates/QA_SHIFT")) {
        record = { ...record, ...request.postDataJSON() };
        saved = true;
        return route.fulfill({ json: record });
      }
      if (request.method() === "GET" || path.endsWith("/auth/login")) return route.continue();
      return route.fulfill({ status: 409, json: { message: "Test writes disabled" } });
    });
    await loginAsAdmin(page);
    await page.goto("/admin/templates");
    await page.locator(".exam-template-card").first().getByRole("button", { name: "수정", exact: true }).click();
    const source = page
      .locator('[data-template-editor-runtime-surface] [data-candidate-block-template-role="source"]')
      .first();
    await source.click();
    const dialog = page.getByRole("dialog", { name: "데이터 블록 편집" });
    const cells = dialog.locator("[data-candidate-block-modal-editor-surface] td");
    const initial = await cells.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
    const startX = initial[0].right,
      y = initial[0].y + initial[0].height / 2;
    await page.keyboard.down("Shift");
    await page.mouse.move(startX, y);
    await page.mouse.down();
    for (const delta of [2, 10, 35, 70]) {
      await page.mouse.move(startX + delta, y);
      const current = await cells.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
      expect(Math.abs(current[0].width - initial[0].width - delta)).toBeLessThan(2);
      expect(Math.abs(current[2].width - initial[2].width)).toBeLessThan(2);
      expect(Math.abs(current[2].right - initial[2].right)).toBeLessThan(2);
    }
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await dialog.getByRole("button", { name: "적용", exact: true }).click();
    await expect(source).toBeVisible();
    await expect(page.locator("[data-template-editor-runtime-surface] [data-candidate-block-grid]")).toHaveCount(1);
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect.poll(() => saved).toBe(true);
    expect(record.layout.layout.pages[0].settings.candidateBlockGrid).toMatchObject({
      enabled: true,
      rows: 20,
      columns: 1,
    });
    await page.reload();
    await expect(source).toBeVisible();
    await source.click();
    await expect(cells).toHaveCount(3);
    await dialog.getByRole("button", { name: "적용", exact: true }).click();
    await expect(source).toBeVisible();
  });

  test("여백 없는 블록의 꽉 찬 표는 미리보기에서 이어진다", async ({ page }) => {
    await page.goto("/");
    const [preview] = await Promise.all([
      page.waitForEvent("popup"),
      page.evaluate(async () => {
        const modulePath = "/src/features/templates/template-renderer.ts";
        const { openTemplatePrintWindow } = await import(/* @vite-ignore */ modulePath);
        const block = (width: number, height: number) =>
          `<div class="examlist-candidate-block" data-candidate-block-instance="1"><table style="width:${width}px;height:${height}px"><tbody><tr style="height:${height}px"><td>수험생</td></tr></tbody></table></div>`;
        const grid = (id: string, gap: number, width: number, height: number) =>
          `<div id="${id}" class="examlist-candidate-block-grid" data-candidate-block-grid="true" style="width:600px;height:180px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(3,minmax(0,1fr));gap:${gap}px">${Array.from({ length: 6 }, () => block(width, height)).join("")}</div>`;
        openTemplatePrintWindow(
          "표 연결 검증",
          '<div class="template-doc">' +
            grid("joined", 0, 297, 57) +
            grid("spaced", 8, 293, 51) +
            grid("partial", 0, 100, 20) +
            "</div>",
        );
      }),
    ]);
    await preview.waitForLoadState();
    const measure = () =>
      preview.evaluate(() => {
        const tables = [...document.querySelectorAll("#joined table")].map((el) => el.getBoundingClientRect());
        const grid = document.querySelector("#joined")!.getBoundingClientRect();
        const spaced = [...document.querySelectorAll("#spaced table")].map((el) => el.getBoundingClientRect());
        const partial = document.querySelector("#partial table") as HTMLTableElement;
        return {
          horizontalGap: tables[1].left - tables[0].right,
          verticalGaps: [tables[2].top - tables[0].bottom, tables[4].top - tables[2].bottom],
          width: grid.width,
          height: grid.height,
          lastBottom: grid.bottom - tables[5].bottom,
          spacedGap: spaced[2].top - spaced[0].bottom,
          partialWidth: partial.style.width,
          partialHeight: partial.style.height,
        };
      });
    for (const media of ["screen", "print"] as const) {
      await preview.emulateMedia({ media });
      const result = await measure();
      expect(Math.abs(result.horizontalGap)).toBeLessThan(0.1);
      result.verticalGaps.forEach((gap) => expect(Math.abs(gap)).toBeLessThan(0.1));
      expect(result.width).toBe(600);
      expect(result.height).toBe(180);
      expect(Math.abs(result.lastBottom)).toBeLessThan(0.1);
      expect(result.spacedGap).toBeGreaterThanOrEqual(8);
      expect(result.partialWidth).toBe("100px");
      expect(result.partialHeight).toBe("20px");
    }
    await preview.close();
  });

  test("미리보기의 데이터 블록과 표 배치가 캔버스와 일치한다", async ({ page }) => {
    await page.route("**/api/v1/**", (route) => {
      const request = route.request();
      if (request.method() === "GET" || new URL(request.url()).pathname.endsWith("/auth/login"))
        return route.continue();
      return route.fulfill({ status: 409, json: { message: "Regression test: writes disabled" } });
    });
    await loginAsAdmin(page);
    await page.goto("/admin/templates");
    await page.getByRole("button", { name: "새 양식", exact: true }).click();
    await page.locator(".admin-modal-backdrop").getByRole("button", { name: "닫기", exact: true }).click();
    for (const [key, value] of [
      ["columns", "2"],
      ["rows", "3"],
      ["gapXPt", "0"],
      ["gapYPt", "0"],
    ]) {
      const input = page.locator(`[data-examlist-block-grid-setting="${key}"]`);
      await input.fill(value);
      await input.press("Tab");
    }
    await page.locator('[data-examlist-block-grid-setting="fillEmptyBlocks"]').check();
    await page.locator("[data-examlist-block-grid-create]").click();
    const surface = page.locator("[data-template-editor-runtime-surface]");
    await surface.locator('[data-candidate-block-template-role="source"]').first().click();
    const dialog = page.getByRole("dialog", { name: "데이터 블록 편집" });
    await clearModalEditor(dialog);
    await insertTable(page, dialog, 1, 3);
    await dialog.getByRole("button", { name: "적용", exact: true }).click();
    const measure = (root: Element) => {
      const documentRect = root.querySelector(".template-doc")!.getBoundingClientRect();
      return [...root.querySelectorAll("[data-candidate-block-grid], [data-candidate-block-instance], table, td")].map(
        (element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            x: rect.x - documentRect.x,
            y: rect.y - documentRect.y,
            width: rect.width,
            height: rect.height,
            display: style.display,
            font: style.fontFamily,
            lineHeight: style.lineHeight,
          };
        },
      );
    };
    const gaps = () =>
      surface.locator("[data-candidate-block-grid] table").evaluateAll((elements) => {
        const rect = (row: string, column: string) =>
          elements
            .find((element) => {
              const block = element.closest<HTMLElement>("[data-candidate-block-instance]")!;
              return block.dataset.candidateBlockGridRow === row && block.dataset.candidateBlockGridColumn === column;
            })!
            .getBoundingClientRect();
        const first = rect("1", "1");
        return [rect("1", "2").left - first.right, rect("2", "1").top - first.bottom].map(
          (value) => Math.round(value * 10) / 10,
        );
      });
    await expect.poll(gaps).toEqual([0, 0]);
    const tableHtml = await surface
      .locator("table")
      .first()
      .evaluate((element) => element.outerHTML.replaceAll(';"', '"'));
    await page.getByRole("button", { name: "캔버스 축소", exact: true }).click();
    await expect.poll(gaps).toEqual([0, 0]);
    expect(
      await surface
        .locator("table")
        .first()
        .evaluate((element) => element.outerHTML.replaceAll(';"', '"')),
    ).toBe(tableHtml);
    await page.locator('[data-action="reset-template-editor-canvas-zoom"]').click();
    await expect.poll(gaps).toEqual([0, 0]);
    const expected = await surface.evaluate(measure);
    const [preview] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("button", { name: "미리보기", exact: true }).click(),
    ]);
    await preview.waitForLoadState();
    await preview.evaluate(() => document.fonts.ready);
    const actual = await preview.locator("body").evaluate(measure);
    expect(actual).toEqual(expected);
    await preview.emulateMedia({ media: "print" });
    expect(await preview.locator("body").evaluate(measure)).toEqual(expected);
    await expect(preview.locator(".print-toolbar")).toBeHidden();
    await preview.close();
  });

  for (const blockRows of [2, 20]) {
    test(`데이터 블록 표 크기를 적용과 재편집 후에도 유지한다 (${blockRows}행)`, async ({ page }) => {
      // This regression never writes to the actual template database.
      await page.route("**/api/v1/**", (route) => {
        const request = route.request();
        if (request.method() === "GET" || new URL(request.url()).pathname.endsWith("/auth/login")) {
          return route.continue();
        }
        return route.fulfill({ status: 409, json: { message: "Regression test: writes disabled" } });
      });
      await loginAsAdmin(page);
      await page.goto("/admin/templates");
      await page.getByRole("button", { name: "새 양식", exact: true }).click();
      await page.locator(".admin-modal-backdrop").getByRole("button", { name: "닫기", exact: true }).click();
      for (const [key, value] of [
        ["columns", "1"],
        ["rows", String(blockRows)],
      ]) {
        const input = page.locator(`[data-examlist-block-grid-setting="${key}"]`);
        await input.fill(value);
        await input.press("Tab");
      }
      await page.locator("[data-examlist-block-grid-create]").click();
      if (blockRows === 2) {
        const grid = page.locator("[data-template-editor-runtime-surface] [data-candidate-block-grid]");
        await selectGridFromOuterBorder(page, grid);
        const handle = grid.locator('[data-candidate-block-grid-resize-corner="bottom"]');
        const box = await handle.boundingBox();
        if (!box) throw new Error("데이터 블록 크기 조절점을 찾을 수 없습니다.");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 150, { steps: 5 });
        await page.mouse.up();
      }
      const source = page
        .locator('[data-template-editor-runtime-surface] [data-candidate-block-template-role="source"]')
        .first();
      await source.click();
      const dialog = page.getByRole("dialog", { name: "데이터 블록 편집" });
      await clearModalEditor(dialog);
      await insertTable(page, dialog, blockRows === 20 ? 1 : 2, 3);
      const table = dialog.locator("[data-candidate-block-modal-editor-surface] table");
      const dimensions = (element: Element) => {
        const tableElement = element as HTMLTableElement;
        return {
          width: tableElement.style.width,
          height: tableElement.style.height,
          columns: [...tableElement.querySelectorAll("col")].map((col) => col.style.width),
          rows: [...tableElement.rows].map((row) => row.style.height),
        };
      };
      const modalGeometry = () =>
        table.evaluate((element) => {
          const host = element.closest<HTMLElement>("[data-candidate-block-modal-editor-surface]")!;
          const rect = element.getBoundingClientRect();
          const hostRect = host.getBoundingClientRect();
          return {
            width: host.dataset.candidateBlockLogicalWidth,
            height: host.dataset.candidateBlockLogicalHeight,
            tableWidth: rect.width,
            tableHeight: rect.height,
            hostWidth: hostRect.width,
            hostHeight: hostRect.height,
          };
        });
      const originalGeometry = await modalGeometry();
      const before = await table.evaluate(dimensions);
      expect(Number.parseFloat(before.width)).toBeGreaterThan(100);
      expect(Number.parseFloat(before.height)).toBeGreaterThan(4);
      await dialog.getByRole("button", { name: "적용", exact: true }).click();
      await expect.poll(() => source.locator("table").evaluate(dimensions)).toEqual(before);
      for (let reopen = 0; reopen < 3; reopen++) {
        await source.click();
        await expect.poll(() => table.evaluate(dimensions)).toEqual(before);
        await expect.poll(modalGeometry).toEqual(originalGeometry);
        await dialog.getByRole("button", { name: "적용", exact: true }).click();
        await expect.poll(() => source.locator("table").evaluate(dimensions)).toEqual(before);
      }
    });
  }

  for (const key of ["Backspace", "Delete"]) {
    test(`데이터 블록 뒤 빈 줄 삭제가 블록과 본문을 유지한다 (${key})`, async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto("/admin/templates");
      await page.locator(".exam-template-card").first().getByRole("button", { name: "수정", exact: true }).click();
      const surface = page.locator("[data-template-editor-runtime-surface]");
      await surface.evaluate((element) => {
        element.innerHTML = '<div class="template-doc"><p>가번호 부여대장</p><p>고사실 정보</p></div>';
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      });
      await page.locator("[data-examlist-block-grid-create]").click();
      await surface.evaluate((element) => {
        const documentElement = element.querySelector(".template-doc")!;
        for (let index = 0; index < 40; index++) {
          const paragraph = document.createElement("p");
          paragraph.append(document.createElement("br"));
          documentElement.append(paragraph);
        }
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      });
      const grid = surface.locator("[data-candidate-block-grid]");
      const originalGrid = await grid.getAttribute("style");
      const blankLines = surface.locator(".template-doc > p").filter({ has: page.locator("br") });
      const originalCount = await blankLines.count();
      await surface.evaluate((element) => {
        const paragraphs = [...element.querySelectorAll(".template-doc > p")].filter((p) => !p.textContent);
        // Keep the old object highlight while editing the blank tail. It must
        // not make Delete target the entire data block.
        element.querySelector("[data-candidate-block-grid]")!.classList.add("is-selected-candidate-block-grid");
        (element as HTMLElement).focus();
        const range = document.createRange();
        range.setStart(paragraphs[0], 0);
        range.setEnd(paragraphs.at(-1)!, paragraphs.at(-1)!.childNodes.length);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
      });
      await page.keyboard.press(key);
      await expect(blankLines).toHaveCount(1);
      await expect(grid).toHaveAttribute("style", originalGrid!);
      await expect(surface).toContainText("가번호 부여대장");
      await expect(surface).toContainText("고사실 정보");
      await page.keyboard.press("Control+z");
      await expect(blankLines).toHaveCount(originalCount);
      await page.keyboard.press("Control+y");
      await expect(blankLines).toHaveCount(1);
      await expect(grid).toHaveCount(1);
    });
  }

  test("1열 20행 데이터 블록을 하단 조절점으로 크게 늘려도 편집 화면이 응답한다", async ({ page }) => {
    await mockBlankEditorTemplate(page, "QA_RESIZE_TALL");
    await loginAsAdmin(page);
    await page.goto("/admin/templates");
    await page.locator(".exam-template-card").first().getByRole("button", { name: "수정", exact: true }).click();
    const surface = page.locator("[data-template-editor-runtime-surface]");
    await surface.evaluate((element) => {
      element.innerHTML = '<div class="template-doc"><p>가번호 부여대장</p><p>전형 정보</p><p>고사실</p></div>';
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    });
    for (const [setting, value] of [
      ["columns", "1"],
      ["rows", "20"],
    ]) {
      const control = page.locator(`[data-examlist-block-grid-setting="${setting}"]`);
      await control.fill(value);
      await control.press("Tab");
    }
    await page.locator("[data-examlist-block-grid-create]").click();
    const grid = surface.locator("[data-candidate-block-grid]");
    await expect(grid).toBeVisible();
    await expect(grid.locator("[data-candidate-block-instance]")).toHaveCount(20);
    const initial = await grid.boundingBox();
    const paragraphCount = await surface.locator(".template-doc > p").count();
    await selectGridFromOuterBorder(page, grid);
    const handle = grid.locator('[data-candidate-block-grid-resize-corner="bottom"]');
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();
    if (!box || !initial) throw new Error("데이터 블록 조절점을 찾을 수 없습니다.");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 950, { steps: 35 });
    const releasedAt = Date.now();
    await page.mouse.up();
    // Allow the deferred overflow measurement to run before testing UI input.
    await page.waitForTimeout(300);
    const title = page.getByLabel("양식 제목", { exact: true });
    await title.fill("크기 조절 응답 확인");
    await expect(title).toHaveValue("크기 조절 응답 확인");
    expect(Date.now() - releasedAt).toBeLessThan(3000);
    const resized = await grid.boundingBox();
    expect(resized!.height).toBeGreaterThan(initial.height + 100);
    expect(await surface.locator(".template-doc > p").count()).toBe(paragraphCount);
    await expect(grid.locator("[data-candidate-block-instance]")).toHaveCount(20);
    await expect(surface).toContainText("고사실");
  });

  for (const selectionMode of ["caret", "mixed", "tag"] as const) {
    test(`줄 단위 정렬과 서식 실행취소 (${selectionMode})`, async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto("/admin/templates");
      await page.locator(".exam-template-card").first().getByRole("button", { name: "수정", exact: true }).click();
      const surface = page.locator("[data-template-editor-runtime-surface]");
      await surface.evaluate((element) => {
        element.innerHTML =
          '<div class="template-doc"><p style="text-align:left"><b>머리글<br><br><span>가번호 부여대장 [</span></b><span class="template-token" contenteditable="false" data-template-token="true" data-template-tag-value="candidate.groupName">조</span><b>]<br><br>본문</b><br>고사실</p></div>';
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      });
      const documentHtml = () => surface.locator(":scope > .template-doc").innerHTML();
      const original = await documentHtml();
      const selectTitle = async () =>
        surface.evaluate((element, mode) => {
          const title = element.querySelector("b > span")!;
          const tag = element.querySelector(".template-token")!;
          const range = document.createRange();
          if (mode === "tag") range.selectNode(tag);
          else {
            range.setStart(title.firstChild!, 0);
            if (mode === "caret") range.collapse(true);
            else range.setEnd(tag.nextSibling!.firstChild!, 1);
          }
          (element as HTMLElement).focus();
          window.getSelection()!.removeAllRanges();
          window.getSelection()!.addRange(range);
        }, selectionMode);
      await selectTitle();
      const selected = await page.evaluate(() => window.getSelection()!.toString());
      await page.locator('[data-template-command="justifyCenter"]').click();
      const lines = surface.locator(".template-doc > div > div");
      await expect(lines).toHaveCount(6);
      await expect(lines.nth(2)).toHaveCSS("text-align", "center");
      for (const index of [0, 1, 3, 4, 5]) await expect(lines.nth(index)).toHaveCSS("text-align", "left");
      await expect(surface).toBeFocused();
      await expect.poll(() => page.evaluate(() => window.getSelection()!.toString())).toBe(selected);
      const centered = await documentHtml();
      await page.keyboard.press("Control+z");
      await expect.poll(documentHtml).toBe(original);
      await page.keyboard.press("Control+Shift+z");
      await expect.poll(documentHtml).toBe(centered);
      await page.keyboard.press("Control+z");
      await expect.poll(documentHtml).toBe(original);
      if (selectionMode !== "caret") {
        await selectTitle();
        await page.locator('[data-template-command="italic"]').click();
        const italic = await documentHtml();
        expect(italic).not.toBe(original);
        await page.keyboard.press("Control+z");
        await expect.poll(documentHtml).toBe(original);
        await page.keyboard.press("Control+y");
        await expect.poll(documentHtml).toBe(italic);
        await page.getByRole("button", { name: "글꼴 크기 목록 열기", exact: true }).click();
        await page.locator('[data-editor-font-size-option="24"]').click();
        const resized = await documentHtml();
        expect(resized).not.toBe(italic);
        await page.keyboard.press("Control+z");
        await expect.poll(documentHtml).toBe(italic);
      }
    });
  }

  for (const kind of ["text", "tag", "mixed"] as const) {
    test(`텍스트 서식 선택 유지·저장 복원 (${kind})`, async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto("/admin/templates");
      await page.locator(".exam-template-card").first().getByRole("button", { name: "수정", exact: true }).click();
      const surface = page.locator("[data-template-editor-runtime-surface]");
      await expect(surface).toBeVisible();
      await surface.evaluate((element, selectedKind) => {
        const token =
          '<span class="template-token" contenteditable="false" data-template-token="true" data-template-tag-value="candidate.name">이름</span>';
        element.innerHTML = `<div class="template-doc"><p id="format-regression">${selectedKind === "text" ? "서식 확인 텍스트" : `앞 ${token} 뒤`}</p></div>`;
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      }, kind);
      const paragraph = surface.locator("#format-regression");
      if (kind === "tag") {
        await paragraph.locator(".template-token").click();
        await expect
          .poll(() => page.evaluate(() => window.getSelection()?.toString()))
          .toBe(await paragraph.locator(".template-token").innerText());
      } else {
        await paragraph.evaluate((element) => {
          element.closest<HTMLElement>("[contenteditable='true']")!.focus();
          const range = document.createRange();
          range.selectNodeContents(element);
          const selection = window.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
        });
      }
      const selectedText = await page.evaluate(() => window.getSelection()!.toString());
      const expectSelection = async () => {
        await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selectedText);
        await expect(surface).toBeFocused();
      };
      await page.getByRole("button", { name: "글꼴 크기 목록 열기", exact: true }).click();
      await page.locator('[data-editor-font-size-option="24"]').click();
      await expectSelection();
      for (const command of ["bold", "italic", "underline"]) {
        await page.locator(`[data-template-command="${command}"]`).click();
        await expectSelection();
      }
      await page.getByRole("button", { name: "글꼴 목록 열기", exact: true }).click();
      await page.locator('[data-editor-font-family-option][data-editor-font-family-label="맑은 고딕"]').click();
      await expectSelection();
      const colorPreset = page.locator('[data-editor-color-command="foreColor"][data-editor-color-preset="#b91c1c"]');
      const colorPicker = page.locator(".template-toolbar-color-picker").filter({ has: colorPreset });
      await colorPicker.locator("[data-editor-color-toggle]").click();
      await colorPreset.click();
      await expectSelection();
      const expectStyles = async () => {
        const textStyles = await paragraph.evaluate((element) => {
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          const result = [];
          let node;
          while ((node = walker.nextNode())) {
            if (!node.textContent?.trim() || node.parentElement?.closest("svg")) continue;
            const style = getComputedStyle(node.parentElement!);
            result.push({
              text: node.textContent,
              size: style.fontSize,
              weight: style.fontWeight,
              italic: style.fontStyle,
              color: style.color,
              family: style.fontFamily,
            });
          }
          return result;
        });
        for (const style of textStyles.filter((style) => kind !== "tag" || !["앞", "뒤"].includes(style.text.trim()))) {
          expect(style.size).toBe("32px");
          expect(Number(style.weight)).toBeGreaterThanOrEqual(600);
          expect(style.italic).toBe("italic");
          expect(style.color).toBe("rgb(185, 28, 28)");
          expect(style.family).toContain("Malgun Gothic");
        }
        if (kind !== "text")
          await expect(paragraph.locator(".template-token")).toHaveAttribute("contenteditable", "false");
      };
      await expectStyles();
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(page.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "양식 목록", exact: true }).click();
      await page.reload();
      await page.locator(".exam-template-card").first().getByRole("button", { name: "수정", exact: true }).click();
      await expect(paragraph).toBeVisible();
      await expectStyles();
    });
  }

  test("표 이동·크기 조절·앞 문단 줄바꿈이 편집 화면을 멈추게 하지 않는다", async ({ page }) => {
    await mockBlankEditorTemplate(page, "QA_TABLE_POINTER");
    await loginAsAdmin(page);
    await page.goto("/admin/templates");
    const firstCard = page.locator(".exam-template-card").first();
    await expect(firstCard).toBeVisible();
    await firstCard.getByRole("button", { name: "수정", exact: true }).click();

    const surface = page.locator("[data-template-editor-runtime-surface]");
    await surface.click();
    await page.getByRole("button", { name: "표 삽입", exact: true }).click();
    const tableInsertInputs = page.locator(".template-table-insert-panel input[type='number']");
    await tableInsertInputs.nth(0).fill("2");
    await tableInsertInputs.nth(1).fill("2");
    await tableInsertInputs.nth(0).press("Enter");
    const table = surface.locator("table").last();
    await expect(table).toBeVisible();
    await selectTableFromOuterBorder(page, table);

    const selectionOverlay = page.locator(".template-editor-table-selection:not(.hidden)");
    await expect(selectionOverlay).toBeVisible();
    const moveHandle = selectionOverlay.locator("[data-template-table-object-move-handle]");
    const moveBox = await moveHandle.boundingBox();
    if (!moveBox) throw new Error("표 이동 핸들 위치를 확인할 수 없습니다.");

    const moveStartedAt = Date.now();
    await page.mouse.move(moveBox.x + moveBox.width / 2, moveBox.y + moveBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(moveBox.x + 40, moveBox.y + 24, { steps: 4 });
    await page.mouse.up();
    expect(Date.now() - moveStartedAt, "표 이동 완료 처리가 3초 안에 끝나야 합니다.").toBeLessThan(3_000);

    const resizeHandle = selectionOverlay.locator('[data-template-table-object-handle-position="bottom-right"]');
    const resizeBox = await resizeHandle.boundingBox();
    if (!resizeBox) throw new Error("표 크기 조절 핸들 위치를 확인할 수 없습니다.");

    const resizeStartedAt = Date.now();
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeBox.x - 35, resizeBox.y - 20, { steps: 4 });
    await page.mouse.up();
    expect(Date.now() - resizeStartedAt, "표 크기 조절 완료 처리가 3초 안에 끝나야 합니다.").toBeLessThan(3_000);

    const paragraphBeforeTable = table.locator("xpath=preceding::p[1]");
    await expect(paragraphBeforeTable).toHaveCount(1);
    await paragraphBeforeTable.evaluate((paragraphElement) => {
      const range = document.createRange();
      const selection = window.getSelection();
      const editorSurface = paragraphElement.closest<HTMLElement>("[contenteditable='true']");

      range.selectNodeContents(paragraphElement);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      editorSurface?.focus();
    });
    const lineBreakStartedAt = Date.now();
    await page.keyboard.press("Enter");
    expect(Date.now() - lineBreakStartedAt, "표 앞 줄바꿈 처리가 3초 안에 끝나야 합니다.").toBeLessThan(3_000);
    await expect(surface).toBeVisible();
  });

  test("빈 캔버스에 삽입한 표를 삭제하면 빈 한 줄만 남는다", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/templates");
    const firstCard = page.locator(".exam-template-card").first();
    await expect(firstCard).toBeVisible();
    await firstCard.getByRole("button", { name: "수정", exact: true }).click();

    const surface = page.locator("[data-template-editor-runtime-surface]");
    await surface.evaluate((surfaceElement) => {
      surfaceElement.innerHTML = '<div class="template-doc"><p><br></p></div>';
      surfaceElement.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      const paragraph = surfaceElement.querySelector("p");
      const selection = window.getSelection();
      const range = document.createRange();

      if (paragraph && selection) {
        range.selectNodeContents(paragraph);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      (surfaceElement as HTMLElement).focus();
    });

    await page.getByRole("button", { name: "표 삽입", exact: true }).click();
    const tableInsertInputs = page.locator(".template-table-insert-panel input[type='number']");
    await tableInsertInputs.nth(0).fill("2");
    await tableInsertInputs.nth(1).fill("2");
    await tableInsertInputs.nth(0).press("Enter");

    const documentElement = surface.locator(":scope > .template-doc");
    const table = documentElement.locator(":scope > table");
    await expect(table).toBeVisible();
    await expect
      .poll(() =>
        documentElement.locator(":scope > *").evaluateAll((elements) => elements.map((element) => element.tagName)),
      )
      .toEqual(["TABLE", "P"]);

    await selectTableFromOuterBorder(page, table);
    await expect(page.locator(".template-editor-table-selection:not(.hidden)")).toBeVisible();
    await page.keyboard.press("Delete");

    await expect(table).toHaveCount(0);
    await expect
      .poll(() =>
        documentElement.locator(":scope > *").evaluateAll((elements) => elements.map((element) => element.tagName)),
      )
      .toEqual(["P"]);
    await expect(documentElement.locator(":scope > p")).toHaveCount(1);
  });

  test("데이터블록 초안 취소·표 삽입 적용·8개 핸들 이동/크기 조절을 검증한다", async ({ page }, testInfo) => {
    await mockBlankEditorTemplate(page, "QA_BLOCK_HANDLES");
    await loginAsAdmin(page);
    await page.goto("/admin/templates");
    const firstCard = page.locator(".exam-template-card").first();
    await expect(firstCard).toBeVisible();

    const openedAt = Date.now();
    await firstCard.getByRole("button", { name: "수정", exact: true }).click();
    await expect(page.getByLabel("양식 제목", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "양식 목록" })).toBeVisible();
    await expect(page.getByRole("button", { name: "미리보기" })).toBeVisible();
    await expect(page.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    expect(Date.now() - openedAt, "편집 화면은 10초 안에 상호작용 가능해야 합니다.").toBeLessThan(10_000);

    const actionAlignment = await page.evaluate(() => {
      const panel = document.querySelector(".template-page-properties-panel")?.getBoundingClientRect();
      const actions = document.querySelector(".template-editor-context-actions")?.getBoundingClientRect();
      return panel && actions ? Math.abs(panel.right - actions.right) : Number.POSITIVE_INFINITY;
    });
    expect(actionAlignment).toBeLessThanOrEqual(2);

    const compactControlFit = await page.evaluate(() => {
      const tableShadingTrigger = [...document.querySelectorAll<HTMLElement>(".template-toolbar-color-trigger")].find(
        (element) =>
          element
            .closest(".template-toolbar-group")
            ?.querySelector(".template-toolbar-group-label")
            ?.textContent?.trim() === "표" &&
          element
            .closest(".template-toolbar-section")
            ?.querySelector(".template-toolbar-section-label")
            ?.textContent?.trim() === "음영",
      );
      const tableShadingLabel = tableShadingTrigger?.querySelector<HTMLElement>(
        ".template-toolbar-color-trigger-label",
      );
      const sortControls = [
        document.querySelector<HTMLSelectElement>('[data-examlist-block-grid-setting="sortKey"]'),
        document.querySelector<HTMLSelectElement>('[data-examlist-block-grid-setting="sortDirection"]'),
      ];
      const sortFits = sortControls.every((control) => {
        if (!control) return false;
        const styles = getComputedStyle(control);
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) return false;
        context.font = styles.font;
        const textWidth = context.measureText(control.selectedOptions[0]?.textContent || "").width;
        const availableWidth =
          control.clientWidth - Number.parseFloat(styles.paddingLeft) - Number.parseFloat(styles.paddingRight);
        return textWidth <= availableWidth;
      });

      return {
        sortFits,
        tableShadingFits: Boolean(tableShadingLabel && tableShadingLabel.scrollWidth <= tableShadingLabel.clientWidth),
      };
    });
    expect(compactControlFit).toEqual({ sortFits: true, tableShadingFits: true });

    const rowCount = page.locator('[data-examlist-block-grid-setting="rows"]');
    await rowCount.fill("2");
    await rowCount.press("Tab");
    await expect(rowCount).toHaveValue("2");
    await page.locator("[data-examlist-block-grid-create]").click();
    const grid = page.locator("[data-candidate-block-grid]").last();
    await expect(grid).toBeVisible();
    await selectGridFromOuterBorder(page, grid);
    await expect(grid.locator("[data-candidate-block-grid-resize-handle]")).toHaveCount(8);

    const source = grid.locator("[data-candidate-block-template-role='source']").first();
    const originalCellCount = await source.locator("table td").count();
    await source.click();
    const dialog = page.getByRole("dialog", { name: "데이터 블록 편집" });
    await expect(dialog).toBeVisible();
    await clearModalEditor(dialog);
    await insertTable(page, dialog, 2, 2);
    await expect(dialog.locator("[data-candidate-block-modal-editor-surface] table td")).toHaveCount(4);
    await dialog.getByRole("button", { name: "취소" }).click();
    await expect(dialog).toBeHidden();
    await expect(source.locator("table td")).toHaveCount(originalCellCount);

    await source.click();
    await expect(dialog).toBeVisible();
    await clearModalEditor(dialog);
    await insertTable(page, dialog, 1, 2);
    await dialog.getByRole("button", { name: "적용" }).click();
    await expect(dialog).toBeHidden();
    const appliedGrid = page.locator("[data-candidate-block-grid]").last();
    await expect(appliedGrid.locator("[data-candidate-block-template-role='source'] table td")).toHaveCount(2);

    await selectGridFromOuterBorder(page, appliedGrid);
    const resizeHandle = appliedGrid.locator('[data-candidate-block-grid-resize-corner="bottom-right"]');
    await resizeHandle.scrollIntoViewIfNeeded();
    await expect(resizeHandle).toBeVisible();
    const initialBox = await appliedGrid.boundingBox();
    const resizeBox = await resizeHandle.boundingBox();
    if (!initialBox || !resizeBox) throw new Error("데이터블록 크기 조절 위치를 확인할 수 없습니다.");
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeBox.x - 80, resizeBox.y - 50, { steps: 4 });
    await page.mouse.up();
    const resizedBox = await appliedGrid.boundingBox();
    if (!resizedBox) throw new Error("조절된 데이터블록 크기를 확인할 수 없습니다.");
    expect(resizedBox.width).toBeLessThan(initialBox.width);

    await selectGridFromOuterBorder(page, appliedGrid);
    const moveHandle = appliedGrid.locator("[data-candidate-block-grid-move-handle]");
    await moveHandle.scrollIntoViewIfNeeded();
    const moveBox = await moveHandle.boundingBox();
    if (!moveBox) throw new Error("데이터블록 이동 핸들 위치를 확인할 수 없습니다.");
    const leftBeforeMove = Number.parseFloat(
      (await appliedGrid.getAttribute("style"))?.match(/left:\s*([\d.]+)px/u)?.[1] || "0",
    );
    await page.mouse.move(moveBox.x + moveBox.width / 2, moveBox.y + moveBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(moveBox.x + 50, moveBox.y + 20, { steps: 4 });
    await page.mouse.up();
    const leftAfterMove = Number.parseFloat(
      (await appliedGrid.getAttribute("style"))?.match(/left:\s*([\d.]+)px/u)?.[1] || "0",
    );
    expect(leftAfterMove).toBeGreaterThan(leftBeforeMove);
    const titleInput = page.getByLabel("양식 제목", { exact: true });
    const baseTitle = (await titleInput.inputValue()).replace(/ · 저장 검증 \d+$/u, "");
    await titleInput.fill(`${baseTitle} · 저장 검증 ${testInfo.repeatEachIndex + 1}`);
    const saveButton = page.getByRole("button", { name: "저장", exact: true });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(saveButton).toBeDisabled();
  });
});

async function loginAsAdmin(page: Page) {
  await page.goto("/");
  await page.getByLabel("아이디").fill("admin");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
}

async function selectGridFromOuterBorder(page: Page, grid: Locator) {
  // Click a visible outer border even when the block is taller than the viewport.
  await grid.click({ position: { x: 1, y: 12 } });
}

async function selectTableFromOuterBorder(page: Page, table: Locator) {
  const box = await table.boundingBox();
  if (!box) throw new Error("표 외곽선 위치를 확인할 수 없습니다.");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height + 2);
}

async function insertTable(page: Page, dialog: Locator, rows: number, columns: number) {
  await page.getByRole("button", { name: "표 삽입", exact: true }).click();
  const inputs = page.locator(".template-table-insert-panel input[type='number']");
  await inputs.nth(0).fill(String(rows));
  await inputs.nth(1).fill(String(columns));
  await inputs.nth(0).press("Enter");
  await expect(dialog.locator("[data-candidate-block-modal-editor-surface] table")).toBeVisible();
}

async function clearModalEditor(dialog: Locator) {
  const surface = dialog.locator("[data-candidate-block-modal-editor-surface]");
  await surface.fill("");
  await expect(surface.locator("table")).toHaveCount(0);
}

function templateResponse(path: string, records: unknown[]) {
  return path.endsWith("/summaries") ? records : records[0];
}

async function mockBlankEditorTemplate(page: Page, code: string) {
  // Resizing starts from an independent blank page, not a default form edited by earlier tests.
  let record = {
    id: 99991,
    code,
    name: "블록 조절 검증",
    description: "",
    category: "문서",
    usageScope: "CANDIDATE",
    active: true,
    layout: {
      id: code,
      layout: {
        pages: [
          {
            id: "blank-page",
            type: "content",
            settings: { documentHtml: '<div class="template-doc"><p><br></p></div>' },
          },
        ],
      },
    },
  };
  await page.route("**/api/v1/form-templates/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/v1/form-templates/admin/"))
      return route.fulfill({ json: templateResponse(path, [record]) });
    if (request.method() === "PUT" && path.endsWith("/" + code)) {
      record = { ...record, ...request.postDataJSON() };
      return route.fulfill({ json: record });
    }
    return route.continue();
  });
}
