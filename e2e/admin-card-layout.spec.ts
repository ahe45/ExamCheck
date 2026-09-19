import { expect, test, type Locator, type Page } from "@playwright/test";

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
]) {
  test(`all template and settings card rows remain reachable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    let templateCount = 5;
    await page.route("**/api/v1/form-templates/admin/summaries", (route) =>
      route.fulfill({
        json: Array.from({ length: templateCount }, (_, index) => ({
          id: 90000 + index,
          code: `LAYOUT_${index}`,
          name: `양식 ${index + 1}`,
          description: "여러 행 스크롤 확인",
          category: "문서",
          usageScope: "CANDIDATE",
          active: true,
          layout: {
            id: `layout-${index}`,
            layout: { pages: [{ id: "page-1", type: "content", settings: { documentHtml: "<p>확인</p>" } }] },
          },
        })),
      }),
    );
    await page.route("**/api/v1/form-templates/admin/LAYOUT_*", (route) =>
      route.fulfill({
        json: {
          id: 90008,
          code: "LAYOUT_8",
          name: "양식 9",
          description: "",
          category: "문서",
          usageScope: "CANDIDATE",
          active: true,
          layout: {
            id: "layout-8",
            layout: { pages: [{ id: "page-1", type: "content", settings: { documentHtml: "<p>확인</p>" } }] },
          },
        },
      }),
    );
    await page.route("**/api/v1/label-templates/summaries", async (route) => {
      const response = await route.fetch();
      const result = await response.json();
      expect(result.templates.length).toBeGreaterThan(0);
      await route.fulfill({
        json: {
          ...result,
          templates: Array.from({ length: 9 }, (_, index) => ({
            ...result.templates[0],
            id: 91000 + index,
            code: `LABEL_LAYOUT_${index}`,
            name: `라벨 ${index + 1}`,
          })),
        },
      });
    });
    await page.route("**/api/v1/pseudonyms/settings-overview?*", (route) =>
      route.fulfill({
        json: Array.from({ length: 7 }, (_, index) => ({
          name: `전형 ${index + 1}`,
          candidates: 10,
          dates: 1,
          schedules: 1,
          buildings: ["시험관"],
          setting: null,
          error: false,
        })),
      }),
    );
    await page.goto("/");
    await page.getByLabel("아이디").fill("admin");
    await page.getByLabel("비밀번호", { exact: true }).fill("1234");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    const header = page.locator(".exam-admin-topbar");
    await header.getByRole("button", { name: "양식 관리", exact: true }).click();

    const cards = page.locator(".exam-template-card");
    for (const count of [5, 9]) {
      templateCount = count;
      if (count === 9) await page.getByRole("button", { name: "새로고침", exact: true }).click();
      await expect(cards).toHaveCount(count);
      await expectLastCardReachable(page, cards);
      await cards.last().getByRole("button", { name: "수정", exact: true }).click({ trial: true });
    }

    await cards.last().getByRole("button", { name: "수정", exact: true }).click();
    await expect(page.locator("[data-template-editor-runtime-surface]")).toBeVisible();
    // Growing the list must not change the editor's bounded workspace.
    const editorBounds = await page.locator(".template-admin-main").boundingBox();
    expect(editorBounds!.y + editorBounds!.height).toBeLessThanOrEqual(viewport.height + 1);
    await header.getByRole("button", { name: "양식 관리", exact: true }).click();
    await page.getByRole("button", { name: "라벨 양식", exact: true }).click();
    await expect(cards).toHaveCount(9);
    await expectLastCardReachable(page, cards);

    await header.getByRole("button", { name: "시스템 설정", exact: true }).click();
    const settingsCards = page.locator(".admission-settings-card");
    await expect(settingsCards).toHaveCount(7);
    await expectLastCardReachable(page, settingsCards);
  });
}

async function expectLastCardReachable(page: Page, cards: Locator) {
  const viewport = page.viewportSize()!;
  await page.mouse.move(300, viewport.height - 100);
  await page.mouse.wheel(0, 10000);
  // Real wheel scrolling must reveal the last footer. Programmatic locator scrolling
  // can scroll an overflow:hidden ancestor and would mask the original clipping bug.
  await expect
    .poll(() =>
      cards
        .last()
        .locator("footer")
        .evaluate((footer) => {
          const bounds = footer.getBoundingClientRect();
          const x = bounds.left + bounds.width / 2;
          const y = bounds.top + bounds.height / 2;
          const visible = document.elementFromPoint(x, y);
          return bounds.bottom <= innerHeight && bounds.top >= 0 && Boolean(visible && footer.contains(visible));
        }),
    )
    .toBe(true);
}
