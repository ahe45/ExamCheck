import { expect, test, type Locator } from "@playwright/test";

const text = '<span id="distribution-text">가나다라마</span>';
const cases = [
  { name: "한 줄 문단", html: `<p>${text}</p><p>다른 문단</p>` },
  { name: "줄바꿈으로 구분한 줄", html: `<p>윗줄<br>${text}<br>아랫줄</p>` },
  { name: "표 안의 문단", html: `<table style="width:400px"><tbody><tr><td><p>${text}</p></td></tr></tbody></table>` },
  {
    name: "선택한 표 셀",
    html: `<table style="width:400px"><tbody><tr><td><p>${text}</p></td></tr><tr><td>두 번째 셀</td></tr></tbody></table>`,
    cell: true,
  },
];

for (const sample of cases) {
  test(`${sample.name}: 배분정렬·정렬 전환·실행취소·저장 복원`, async ({ page }) => {
    let record = {
      id: 99993,
      code: "QA_DISTRIBUTION",
      name: "배분정렬 검증",
      category: "문서",
      usageScope: "CANDIDATE",
      active: false,
      layout: {
        layout: {
          pages: [
            {
              id: "distribution-page",
              type: "content",
              settings: {
                documentHtml: `<div class="template-doc">${sample.html}</div>`,
              },
            },
          ],
        },
      },
    };
    let saved = false;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/v1/**", (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/form-templates/admin")) return route.fulfill({ json: [record] });
      if (path.endsWith("/form-templates/QA_DISTRIBUTION") && request.method() === "PUT") {
        record = { ...record, ...request.postDataJSON() };
        saved = true;
        return route.fulfill({ json: record });
      }
      if (request.method() === "GET" || path.endsWith("/auth/login")) return route.continue();
      return route.fulfill({ status: 409, json: { message: "Test writes disabled" } });
    });
    await page.goto("/");
    await page.getByLabel("아이디").fill("admin");
    await page.getByLabel("비밀번호", { exact: true }).fill("1234");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.getByRole("button", { name: "양식 관리", exact: true }).click();
    await page.locator(".exam-template-card").getByRole("button", { name: "수정", exact: true }).click();
    const surface = page.locator("[data-template-editor-runtime-surface]");
    const target = surface.locator("#distribution-text");
    await expect(target).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const original = await measureText(target);
    const select = async () => {
      if (sample.cell) {
        const cells = surface.locator("td");
        const first = (await cells.first().boundingBox())!;
        const last = (await cells.last().boundingBox())!;
        await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
        await page.mouse.down();
        await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 8 });
        await page.mouse.up();
        await expect(surface.locator(".is-selected-cell")).toHaveCount(2);
        return;
      }
      await target.evaluate((element) => {
        element.closest<HTMLElement>("[contenteditable='true']")!.focus();
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(true);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
      });
    };
    const apply = async (command: string) => {
      await select();
      await page.locator(`[data-template-command="${command}"]`).click();
    };
    const expectDistributed = async () => {
      await expect.poll(async () => (await measureText(target)).coverage).toBeGreaterThan(0.98);
      expect((await measureText(target)).alignmentLast).toBe("justify");
    };
    await apply("justifyFull");
    await expectDistributed();
    // Verify real character positions, not only a CSS declaration.
    expect((await measureText(target)).width).toBeGreaterThan(original.width * 3);
    await surface.focus();
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await measureText(target)).width).toBeCloseTo(original.width, 1);
    await page.keyboard.press("Control+y");
    await expectDistributed();
    for (const command of ["justifyCenter", "justifyRight", "justifyLeft"]) {
      await apply(command);
      const current = await measureText(target);
      expect(current.alignmentLast).toBe("auto");
      expect(current.width).toBeCloseTo(original.width, 1);
      if (command === "justifyCenter") expect(current.leftGap).toBeCloseTo(current.rightGap, 0);
      if (command === "justifyRight") expect(current.rightGap).toBeLessThan(1);
      if (command === "justifyLeft") expect(current.leftGap).toBeLessThan(1);
    }
    await apply("justifyFull");
    await expectDistributed();
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect.poll(() => saved).toBe(true);
    await page.reload();
    await expect(target).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expectDistributed();
    expect(errors).toEqual([]);
  });
}

async function measureText(target: Locator) {
  return target.evaluate((element) => {
    const block = element.closest("p,div,td")!;
    const style = getComputedStyle(block);
    const box = block.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const textBox = range.getBoundingClientRect();
    const left = box.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    const right = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
    return {
      width: textBox.width,
      coverage: textBox.width / (right - left),
      leftGap: textBox.left - left,
      rightGap: right - textBox.right,
      alignmentLast: style.textAlignLast,
    };
  });
}
