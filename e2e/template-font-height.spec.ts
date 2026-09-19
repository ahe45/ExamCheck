import { expect, test, type Locator } from "@playwright/test";

const cases = [
  { name: "문단", html: "<p>윗줄</p><p>확대할 문장</p><p>아랫줄</p>", spacing: 1 },
  {
    name: "정렬된 문단",
    html: '<div style="font-size:11pt;line-height:16px"><div>윗줄</div><div>확대할 문장</div><div>아랫줄</div></div>',
    spacing: 1,
  },
  {
    name: "표 안의 여러 줄",
    html: '<table><tbody><tr><td style="font-size:11pt;line-height:16px">윗줄<br>확대할 문장<br>아랫줄</td></tr></tbody></table>',
    spacing: 1,
  },
  {
    name: "사용자 지정 줄 간격",
    html: '<p>윗줄</p><p style="font-size:11pt;line-height:20px">확대할 문장</p><p>아랫줄</p>',
    spacing: 4,
  },
  {
    name: "글자와 데이터 태그",
    html: '<p>윗줄</p><p>확대할 문장<span class="template-token" contenteditable="false" data-template-tag-value="signature.author" style="font-size:11pt;line-height:calc(1em + 1pt)">작성자</span></p><p>아랫줄</p>',
    spacing: 1,
    mixed: true,
  },
];

for (const sample of cases) {
  test(`${sample.name}: 11pt에서 20pt로 키우면 줄 높이가 늘고 저장 후에도 유지된다`, async ({ page }) => {
    let record = {
      id: 99992,
      code: "QA_FONT_HEIGHT",
      name: "글자 높이 검증",
      category: "문서",
      usageScope: "CANDIDATE",
      active: false,
      layout: {
        layout: {
          pages: [
            {
              id: "font-page",
              type: "content",
              settings: { documentHtml: `<div class="template-doc">${sample.html}</div>` },
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
      if (path.startsWith("/api/v1/form-templates/admin/"))
        return route.fulfill({ json: templateResponse(path, [record]) });
      if (path.endsWith("/form-templates/QA_FONT_HEIGHT") && request.method() === "PUT") {
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
    await expect(surface).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const before = await measureLines(surface);

    const setFontSize = async (size: number) => {
      await surface.evaluate((element, mixed) => {
        const walker = document.createTreeWalker(element.querySelector(".template-doc")!, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (walker.currentNode.textContent !== "확대할 문장") continue;
          (element as HTMLElement).focus();
          const range = document.createRange();
          range.selectNodeContents(mixed ? walker.currentNode.parentElement!.closest("p")! : walker.currentNode);
          const selection = window.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
          return;
        }
        throw new Error("서식을 적용할 문장을 찾지 못했습니다.");
      }, sample.mixed ?? false);
      await page.getByRole("button", { name: "글꼴 크기 목록 열기", exact: true }).click();
      await page.locator(`[data-editor-font-size-option="${size}"]`).click();
    };
    await setFontSize(20);
    const enlarged = await measureLines(surface);
    expect(enlarged.font).toBeCloseTo((20 * 4) / 3, 2);
    expect(enlarged.lineHeight).toBeCloseTo(((20 + sample.spacing) * 4) / 3, 2);
    expect(enlarged.nextTop - before.nextTop).toBeGreaterThanOrEqual(11.9);
    expect(enlarged.nextFont).toBeCloseTo((11 * 4) / 3, 2);
    if (sample.mixed) expect(enlarged.tokenLineHeight).toBeCloseTo(enlarged.lineHeight, 2);

    await surface.focus();
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await measureLines(surface)).nextTop).toBeCloseTo(before.nextTop, 1);
    await page.keyboard.press("Control+y");
    await expect.poll(async () => (await measureLines(surface)).lineHeight).toBeCloseTo(enlarged.lineHeight, 2);
    await setFontSize(11);
    await expect.poll(async () => (await measureLines(surface)).nextTop).toBeCloseTo(before.nextTop, 1);
    await setFontSize(20);
    expect((await measureLines(surface)).lineHeight).toBeCloseTo(enlarged.lineHeight, 2);

    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect.poll(() => saved).toBe(true);
    await page.reload();
    await expect(surface).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const reloaded = await measureLines(surface);
    expect(reloaded.lineHeight).toBeCloseTo(enlarged.lineHeight, 2);
    expect(reloaded.nextTop).toBeCloseTo(enlarged.nextTop, 1);
    // Changing paragraph spacing after enlarging text must also reach the
    // inline font-size wrappers retained through serialization.
    await setFontSize(20);
    await page.getByRole("button", { name: "줄 간격 목록 열기", exact: true }).click();
    await page.locator('[data-template-line-height-option="5"]').click();
    expect((await measureLines(surface)).lineHeight).toBeCloseTo((25 * 4) / 3, 2);
    expect(errors).toEqual([]);
  });
}

async function measureLines(surface: Locator) {
  return surface.evaluate((element) => {
    const content = element.querySelector(".template-doc")!;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let target: HTMLElement | null = null;
    let next: Text | null = null;
    while (walker.nextNode()) {
      if (walker.currentNode.textContent === "확대할 문장") target = walker.currentNode.parentElement;
      if (walker.currentNode.textContent === "아랫줄") next = walker.currentNode as Text;
    }
    if (!target || !next) throw new Error("검증할 줄을 찾지 못했습니다.");
    const style = getComputedStyle(target);
    const range = document.createRange();
    range.selectNodeContents(next);
    const token = content.querySelector("[data-template-tag-value]");
    return {
      font: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight),
      nextTop: range.getBoundingClientRect().top - content.getBoundingClientRect().top,
      nextFont: Number.parseFloat(getComputedStyle(next.parentElement!).fontSize),
      tokenLineHeight: token ? Number.parseFloat(getComputedStyle(token).lineHeight) : null,
    };
  });
}

function templateResponse(path: string, records: unknown[]) {
  return path.endsWith("/summaries") ? records : records[0];
}
