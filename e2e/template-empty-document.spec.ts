import { expect, test } from "@playwright/test";

const blankLines =
  '<div style="text-align: center; margin-top: 0px; margin-bottom: 1.33333px; font-size: 14.6667px; font-weight: 400; line-height: 16px"><div style="text-align: left"><br></div></div>' +
  "<p><br></p><p><br></p><p><br></p>";

for (const key of ["Backspace", "Delete"]) {
  test(`복사한 사진대장의 빈 줄을 ${key}로 전체 삭제하고 되돌릴 수 있다`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const record = {
      id: 99993,
      code: "QA_EMPTY_PHOTO_REGISTER",
      name: "빈 사진대장 검증",
      category: "문서",
      usageScope: "CANDIDATE",
      active: false,
      layout: {
        id: "blank-template",
        layout: {
          pages: [
            {
              id: "blank-page",
              type: "content",
              settings: {
                documentHtml: `<div class="template-doc" data-template-page-margin-top="10">${blankLines}</div>`,
                editorMode: "document",
                safeArea: { bottom: 28.35, left: 28.35, right: 28.35, top: 28.35 },
              },
            },
          ],
        },
      },
    };
    await page.route("**/api/v1/**", (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/form-templates/admin")) return route.fulfill({ json: [record] });
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
    const content = surface.locator(":scope > .template-doc");
    await expect(content.locator("br")).toHaveCount(4);
    await surface.focus();
    await page.keyboard.press("Control+a");
    await page.keyboard.press(key);
    await expect(content.locator("br")).toHaveCount(1);
    await expect(content).toHaveAttribute("data-template-page-margin-top", "10");
    await page.keyboard.press("Control+z");
    await expect(content.locator("br")).toHaveCount(4);
    await page.keyboard.press("Control+y");
    await expect(content.locator("br")).toHaveCount(1);

    await page.keyboard.press("Control+z");
    await expect(content.locator("br")).toHaveCount(4);
    await page.keyboard.press(key === "Backspace" ? "Control+End" : "Control+Home");
    for (const remaining of [3, 2, 1]) {
      await page.keyboard.press(key);
      await expect(content.locator("br")).toHaveCount(remaining);
    }

    // Keep the final caret line, then allow normal input without restoring
    // the deleted spacing or losing the page wrapper.
    await page.keyboard.press(key);
    await expect(content.locator("br")).toHaveCount(1);
    await page.keyboard.type("Photo register");
    await expect(content).toHaveText("Photo register");
    expect(errors).toEqual([]);
  });
}
