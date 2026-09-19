import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { candidateFields } from "../apps/api/src/candidates/candidate-fields";

test("uploads once, pages on the server, and downloads a completed export", async ({ page }) => {
  await login(page, "admin");
  await page.getByRole("button", { name: "수험생 데이터", exact: true }).click();
  await page.getByRole("button", { name: "데이터 업로드", exact: true }).click();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("수험생등록");
  sheet.addRow(candidateFields.map((field) => field.label));
  for (let index = 0; index < 1000; index++)
    sheet.addRow(
      candidateFields.map((field) =>
        field.key === "examineeNo" ? `PERF-${index}` : field.key === "temporaryNo" ? "" : field.sample,
      ),
    );
  const importRequest = page.waitForRequest((request) =>
    new URL(request.url()).pathname.endsWith("/candidates/import"),
  );
  await page.locator('input[accept=".xlsx"]').setInputFiles({
    name: "performance.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  });
  const execute = page.getByRole("button", { name: "업로드 실행", exact: true });
  await expect(execute).toBeEnabled({ timeout: 20000 });
  await execute.click();
  const request = await importRequest;
  expect(request.postData()).toBeNull();
  expect(request.headers()["x-candidate-preview-token"]).toBeTruthy();
  await expect(page.locator("[data-app-toast-viewport] [role=status]")).toContainText("1000", { timeout: 20000 });
  await expect(page.locator(".candidate-data-table tbody tr")).toHaveCount(30);
  const before = await page.locator(".candidate-data-table tbody tr").first().textContent();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.locator(".candidate-data-table tbody tr").first()).not.toHaveText(before!);
  await expect(page.locator(".candidate-data-table tbody tr")).toHaveCount(30);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "다운로드", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("수험생 데이터.xlsx");
});

test("renders a bounded roster and reaches the final row by scrolling", async ({ page }) => {
  await page.route("**/api/v1/examinees/operation/roster?*", async (route) => {
    const response = await route.fetch();
    const rows = await response.json();
    expect(rows.length).toBeGreaterThan(0);
    await route.fulfill({
      json: Array.from({ length: 5000 }, (_, index) => ({
        ...rows[0],
        id: index + 100000,
        examineeNo: `VIRTUAL-${String(index).padStart(5, "0")}`,
        name: `명단 ${index}`,
      })),
    });
  });
  await login(page, "가번호");
  await page.locator(".operation-schedule-card").first().click();
  const rendered = page.locator("tr[data-roster-index]");
  await expect(rendered.first()).toBeVisible();
  expect(await rendered.count()).toBeLessThan(100);
  await page.locator(".operator-roster-panel").evaluate((panel) => {
    const row = panel.querySelector("tr[data-roster-index]")!;
    let element = row.parentElement;
    while (element && element.scrollHeight <= element.clientHeight) element = element.parentElement;
    if (!element) throw new Error("Roster scroll viewport missing");
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(page.locator('tr[data-roster-index="4999"]')).toBeVisible();
  expect(await rendered.count()).toBeLessThan(100);
});

async function login(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("아이디").fill(name);
  await page.getByLabel("비밀번호", { exact: true }).fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
}
