import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const accounts = {
  admin: { loginId: "admin", password: "1234" },
  developer: { loginId: "dev", password: "1234" },
  operator: { loginId: "가번호", password: "1234" },
} as const;

test.describe("역할별 읽기 전용 smoke", () => {
  test("관리자 계정으로 대시보드를 표시한다", async ({ page }, testInfo) => {
    await login(page, accounts.admin);

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "전형 운영 대시보드" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "관리자 메뉴" })).toBeVisible();
    await expect(page.getByText("admin", { exact: true })).toBeVisible();

    await verifyReadOnlyPage(page, testInfo, "admin-dashboard");
  });

  test("개발자 계정으로 번호 유일 정책을 표시한다", async ({ page }, testInfo) => {
    await login(page, accounts.developer);
    await page.getByRole("button", { name: "개발자", exact: true }).click();

    await expect(page).toHaveURL(/\/admin\/developer$/);
    await expect(page.getByRole("heading", { name: "시스템 기본 정보" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "번호 유일 정책" })).toBeVisible();

    const examineePolicy = page.getByRole("group", { name: "수험번호 유일 정책" });
    const pseudonymPolicy = page.getByRole("group", { name: "가번호 유일 정책" });
    await expect(examineePolicy.getByRole("radio", { name: /시스템 전체/ })).toBeChecked();
    await expect(pseudonymPolicy.getByRole("radio", { name: /전형 전체/ })).toBeChecked();
    await expect(page.getByRole("button", { name: "설정 저장" })).toBeDisabled();

    await verifyReadOnlyPage(page, testInfo, "developer-uniqueness");
  });

  test("사용자 계정으로 첫 교시의 운영 화면에 진입한다", async ({ page }, testInfo) => {
    await login(page, accounts.operator);

    await expect(page).toHaveURL(/\/operation\/select$/);
    const firstSchedule = page.locator(".operation-schedule-card").first();
    await expect(firstSchedule).toBeVisible();
    await firstSchedule.click();

    await expect(page).toHaveURL(/\/operation$/);
    await expect(page.getByRole("textbox", { name: "수험번호" })).toBeVisible();
    await expect(page.getByRole("button", { name: "교시 변경" })).toBeVisible();
    await expect(page.getByRole("button", { name: "등록 완료(마감)" })).toBeVisible();

    const operatorLayout = await page.evaluate(() => {
      const controlPanel = document.querySelector<HTMLElement>(".operator-control-panel");
      const examineeInput = document.querySelector<HTMLElement>("#operator-examinee-no");
      return {
        pageHeight: document.documentElement.scrollHeight,
        viewportHeight: document.documentElement.clientHeight,
        controlWidth: controlPanel?.getBoundingClientRect().width ?? 0,
        controlScrollHeight: controlPanel?.scrollHeight ?? 0,
        controlClientHeight: controlPanel?.clientHeight ?? 0,
        inputFontSize: examineeInput ? Number.parseFloat(getComputedStyle(examineeInput).fontSize) : 0,
      };
    });
    expect(operatorLayout.controlWidth).toBeGreaterThan(0);
    expect(operatorLayout.inputFontSize).toBeGreaterThan(0);
    if (testInfo.project.name === "fhd" || testInfo.project.name === "qhd") {
      expect(
        operatorLayout.pageHeight,
        "FHD 이상에서는 운영 화면 자체에 세로 스크롤이 없어야 합니다.",
      ).toBeLessThanOrEqual(operatorLayout.viewportHeight + 1);
      expect(
        operatorLayout.controlScrollHeight,
        "FHD 이상에서는 좌측 운영 패널 내용이 내부 스크롤 없이 표시되어야 합니다.",
      ).toBeLessThanOrEqual(operatorLayout.controlClientHeight + 1);
    }
    if (testInfo.project.name === "qhd") {
      expect(operatorLayout.controlWidth).toBeGreaterThanOrEqual(700);
      expect(operatorLayout.inputFontSize).toBeGreaterThanOrEqual(30);
    } else if (testInfo.project.name === "fhd") {
      expect(operatorLayout.controlWidth).toBeGreaterThanOrEqual(450);
      expect(operatorLayout.inputFontSize).toBeGreaterThanOrEqual(24);
    }

    await verifyReadOnlyPage(page, testInfo, "operator-first-schedule");
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

async function verifyReadOnlyPage(page: Page, testInfo: TestInfo, name: string) {
  await expect.poll(async () => page.evaluate(() => document.fonts.status)).toBe("loaded");

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("브라우저 viewport 정보를 확인할 수 없습니다.");
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.clientWidth).toBe(viewport.width);
  expect(layout.scrollWidth, "페이지에 가로 스크롤이 없어야 합니다.").toBeLessThanOrEqual(viewport.width + 1);

  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await testInfo.attach(`${name}-${testInfo.project.name}`, { path: screenshotPath, contentType: "image/png" });

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  if (accessibility.violations.length) {
    const accessibilityPath = testInfo.outputPath("axe-violations.json");
    await writeFile(accessibilityPath, JSON.stringify(accessibility.violations, null, 2), "utf8");
    await testInfo.attach("axe-violations.json", {
      path: accessibilityPath,
      contentType: "application/json",
    });
  }
  expect(
    accessibility.violations.map(({ id, impact, help, nodes }) => ({
      id,
      impact,
      help,
      nodes: nodes.length,
      targets: nodes.slice(0, 12).flatMap((node) => node.target.map(String)),
    })),
    "핵심 화면에 WCAG A/AA 위반이 없어야 합니다.",
  ).toEqual([]);
}
