import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { resolve } from "node:path";

const accounts = {
  admin: { loginId: "admin", password: "1234" },
  developer: { loginId: "dev", password: "1234" },
  operator: { loginId: "가번호", password: "1234" },
} as const;

const visualSnapshotStylePath = resolve("e2e/visual-snapshot.css");

test.describe("FHD/QHD 공식 시각 기준", () => {
  test("로그인", async ({ page }, testInfo) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "계정 로그인" })).toBeVisible();
    await expect(page.getByRole("button", { name: "로그인", exact: true })).toBeDisabled();
    await expectVisualBaseline(page, testInfo, "login");
  });

  test("관리자 대시보드", async ({ page }, testInfo) => {
    await login(page, accounts.admin);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "전형 운영 대시보드" })).toBeVisible();
    await expect(page.getByRole("button", { name: "새로고침" })).toBeEnabled();
    await expect(page.getByText("CI-E2E-SMOKE-전형", { exact: true })).toBeVisible();
    await expectVisualBaseline(page, testInfo, "admin-dashboard");
  });

  test("관리자 수험생 데이터", async ({ page }, testInfo) => {
    await login(page, accounts.admin);
    await page.goto("/admin/candidates");
    await expect(page.getByRole("heading", { name: "수험생 데이터" })).toBeVisible();
    await expect(page.getByRole("button", { name: "새로고침" })).toBeEnabled();
    await expect(page.getByText("CI-E2E-SMOKE-001", { exact: true })).toBeVisible();
    await expectVisualBaseline(page, testInfo, "admin-candidates");
  });

  test("관리자 양식 관리", async ({ page }, testInfo) => {
    await login(page, accounts.admin);
    await page.goto("/admin/templates");
    await expect(page.getByRole("heading", { name: "양식 관리" })).toBeVisible();
    await expect(page.getByRole("button", { name: "새로고침" })).toBeEnabled();
    await expect(page.locator(".exam-template-card")).toHaveCount(2);
    await expectVisualBaseline(page, testInfo, "admin-templates");
  });

  test("관리자 시스템 설정", async ({ page }, testInfo) => {
    await login(page, accounts.admin);
    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { name: "시스템 설정" })).toBeVisible();
    await expect(page.getByRole("button", { name: "새로고침" })).toBeEnabled();
    await expect(page.locator(".admission-settings-card")).toHaveCount(3);
    await expectVisualBaseline(page, testInfo, "admin-system-settings");
  });

  test("관리자 계정 관리", async ({ page }, testInfo) => {
    await login(page, accounts.admin);
    await page.goto("/admin/accounts");
    await expect(page.getByRole("heading", { name: "계정 관리" })).toBeVisible();
    await expect(page.getByRole("button", { name: "새로고침" })).toBeEnabled();
    await expect(page.getByText("admin", { exact: true }).first()).toBeVisible();
    await expectVisualBaseline(page, testInfo, "admin-accounts");
  });

  test("개발자 설정", async ({ page }, testInfo) => {
    await login(page, accounts.developer);
    await page.goto("/admin/developer");
    await expect(page.getByRole("heading", { name: "시스템 기본 정보" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "번호 유일 정책" })).toBeVisible();
    await expect(page.getByRole("button", { name: "설정 저장" })).toBeDisabled();
    await expectVisualBaseline(page, testInfo, "developer-settings");
  });

  test("사용자 교시 선택", async ({ page }, testInfo) => {
    await login(page, accounts.operator);
    await expect(page).toHaveURL(/\/operation\/select$/);
    await expect(page.locator(".operation-schedule-card").first()).toBeVisible();
    await expect(page.getByText("CI-E2E-SMOKE-1교시", { exact: true })).toBeVisible();
    await expectVisualBaseline(page, testInfo, "operator-schedule");
  });

  test("사용자 운영 콘솔", async ({ page }, testInfo) => {
    await login(page, accounts.operator);
    const firstSchedule = page.locator(".operation-schedule-card").first();
    await expect(firstSchedule).toBeVisible();
    await firstSchedule.click();
    await expect(page).toHaveURL(/\/operation$/);
    await expect(page.getByRole("textbox", { name: "수험번호" })).toBeVisible();
    await expect(page.getByText("CI-E2E-SMOKE-001", { exact: true })).toBeVisible();
    await expectVisualBaseline(page, testInfo, "operator-console");
  });
});

async function login(page: Page, account: { loginId: string; password: string }) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "계정 로그인" })).toBeVisible();
  await page.getByLabel("아이디").fill(account.loginId);
  await page.getByLabel("비밀번호").fill(account.password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
}

async function expectVisualBaseline(page: Page, testInfo: TestInfo, name: string) {
  await waitForProjectFonts(page);
  await normalizeVisualState(page);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("브라우저 viewport 정보를 확인할 수 없습니다.");
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.clientWidth).toBe(viewport.width);
  expect(layout.scrollWidth, `${name} 화면에 가로 스크롤이 없어야 합니다.`).toBeLessThanOrEqual(viewport.width + 1);

  await expect(page).toHaveScreenshot(`${name}.png`, {
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    maxDiffPixels: 100,
    scale: "css",
    stylePath: visualSnapshotStylePath,
    threshold: 0.15,
  });
}

async function waitForProjectFonts(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        await Promise.all([
          document.fonts.load('16px "DM Sans Variable"', "ExamCheck 2026"),
          document.fonts.load('16px "Noto Sans KR Variable"', "가번호 관리 시스템"),
        ]);
        await document.fonts.ready;
        return {
          dmSans: document.fonts.check('16px "DM Sans Variable"', "ExamCheck 2026"),
          notoSansKr: document.fonts.check('16px "Noto Sans KR Variable"', "가번호 관리 시스템"),
        };
      }),
    )
    .toEqual({ dmSans: true, notoSansKr: true });
}

async function normalizeVisualState(page: Page) {
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    for (const element of document.querySelectorAll<HTMLElement>("*")) {
      if (element.scrollTop || element.scrollLeft) element.scrollTo(0, 0);
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}
