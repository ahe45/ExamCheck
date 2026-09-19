import { expect, test } from "@playwright/test";

test("데이터 블록 양식에서 헤더 메뉴로 반복 이동해도 편집기가 멈추지 않는다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const table = '<table style="width:600px;height:30px"><tbody><tr><td>수험생</td></tr></tbody></table>';
  const blocks = Array.from(
    { length: 20 },
    (_, index) => `<div class="examlist-candidate-block" data-candidate-block-instance="${index + 1}">${table}</div>`,
  ).join("");
  const html =
    '<div class="template-doc"><p>가번호 부여대장</p>' +
    '<div class="examlist-candidate-block-grid" data-candidate-block-grid="true" data-candidate-block-columns="1" data-candidate-block-rows="20" style="position:absolute;left:0;top:80px;width:600px;height:700px;display:grid;grid-template-columns:1fr;grid-template-rows:repeat(20,1fr);gap:0">' +
    blocks +
    '</div><p><br></p><table style="position:absolute;left:0;top:900px;width:600px;height:40px"><tbody><tr><td>작성자</td></tr></tbody></table><p><br></p></div>';
  const record = {
    id: 99994,
    code: "QA_HEADER_NAVIGATION",
    name: "헤더 이동 검증",
    category: "문서",
    usageScope: "CANDIDATE",
    active: true,
    layout: {
      id: "navigation-template",
      layout: { pages: [{ id: "navigation-page", type: "content", settings: { documentHtml: html } }] },
    },
  };
  await page.route("**/api/v1/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/v1/form-templates/admin/"))
      return route.fulfill({ json: templateResponse(path, [record]) });
    if (request.method() === "GET" || path.endsWith("/auth/login")) return route.continue();
    return route.fulfill({ status: 409, json: { message: "Test writes disabled" } });
  });
  await page.goto("/");
  await page.getByLabel("아이디").fill("admin");
  await page.getByLabel("비밀번호", { exact: true }).fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  const header = page.locator(".exam-admin-topbar");
  await header.getByRole("button", { name: "양식 관리", exact: true }).click();
  const card = page.locator(".exam-template-card");
  const surface = page.locator("[data-template-editor-runtime-surface]");

  for (const target of ["양식 관리", "시스템 설정", "수험생 데이터", "계정 관리", "대시보드로 이동", "양식 관리"]) {
    await card.getByRole("button", { name: "수정", exact: true }).click();
    await expect(surface.locator("[data-candidate-block-grid]")).toBeVisible();
    await header.getByRole("button", { name: target, exact: true }).click();
    // Legacy markup can become dirty when its missing block settings are
    // recovered. Both immediate exit and confirmed exit must release the editor.
    const confirmation = page.getByRole("dialog");
    await expect.poll(async () => (await surface.count()) === 0 || (await confirmation.isVisible())).toBe(true);
    if (await confirmation.isVisible()) {
      await confirmation.getByRole("button", { name: "저장 안 함", exact: true }).click();
    }
    await expect(surface).toHaveCount(0);
    await header.getByRole("button", { name: "양식 관리", exact: true }).click();
    await expect(card.getByRole("button", { name: "수정", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  }

  // Unsaved edits must still open a responsive confirmation instead of
  // destroying the editor before the user decides whether to leave.
  await card.getByRole("button", { name: "수정", exact: true }).click();
  await expect(surface).toBeVisible();
  await page.getByLabel("양식 제목", { exact: true }).fill("저장하지 않은 양식");
  await header.getByRole("button", { name: "시스템 설정", exact: true }).click();
  const confirmation = page.getByRole("dialog");
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "취소", exact: true }).click();
  await expect(surface).toBeVisible();
  await header.getByRole("button", { name: "양식 관리", exact: true }).click();
  await confirmation.getByRole("button", { name: "저장 안 함", exact: true }).click();
  await expect(surface).toHaveCount(0);
  await expect(card.getByRole("button", { name: "수정", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

function templateResponse(path: string, records: unknown[]) {
  return path.endsWith("/summaries") ? records : records[0];
}
