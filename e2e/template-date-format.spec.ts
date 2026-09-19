import { expect, test } from "@playwright/test";
import { formTemplateDataTags } from "../apps/api/src/form-templates/form-template-tags";

test("날짜·시간 태그의 형식 변경, 실행 취소, 저장 복원과 미리보기", async ({ page }) => {
  const user = { id: 99991, loginId: "검증", role: "ADMIN", admissionNames: [] };
  const cases = [
    { key: "candidate.examDate", format: "YYYY.MM.DD (ddd)", text: "2026.10.30 (금)" },
    { key: "candidate.birthDate", format: "YY.MM.DD", text: "08.07.24" },
    { key: "candidate.examStartTime", format: "A h시 mm분", text: "오전 10시 00분" },
    { key: "candidate.examEndTime", format: "A h:mm", text: "오후 12:00" },
    { key: "system.printedAt", format: "YYYY.MM.DD (ddd) A h:mm", text: "2026.09.12 (토) 오전 9:30" },
  ];
  let record = {
    id: 99995,
    code: "QA_DATE_FORMAT",
    name: "날짜 시간 형식 검증",
    category: "문서",
    usageScope: "CANDIDATE",
    active: false,
    layout: {
      layout: {
        pages: [
          {
            id: "date-page",
            type: "content",
            settings: {
              documentHtml: `<div class="template-doc">${[...cases, cases[0]].map(({ key }) => `<p><span class="template-token" data-template-tag-value="${key}" contenteditable="false">${key}</span></p>`).join("")}</div>`,
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
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path.endsWith("/auth/login")) return route.fulfill({ json: { token: "qa-date-format", user } });
    if (path.endsWith("/auth/me")) return route.fulfill({ json: user });
    if (path.endsWith("/system-profile")) return route.continue();
    if (path.endsWith("/form-templates/data-tags")) return route.fulfill({ json: formTemplateDataTags });
    if (path.startsWith("/api/v1/form-templates/admin/"))
      return route.fulfill({ json: templateResponse(path, [record]) });
    if (path.endsWith("/form-templates/QA_DATE_FORMAT") && request.method() === "PUT") {
      record = { ...record, ...request.postDataJSON() };
      saved = true;
      return route.fulfill({ json: record });
    }
    return route.fulfill({ status: 409, json: { message: "검증용 요청" } });
  });
  await page.goto("/");
  await page.getByLabel("아이디").fill("검증");
  await page.getByLabel("비밀번호", { exact: true }).fill("qa1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByRole("button", { name: "양식 관리", exact: true }).click();
  await page.locator(".exam-template-card").getByRole("button", { name: "수정", exact: true }).click();
  const surface = page.locator("[data-template-editor-runtime-surface]");
  await expect(surface).toBeVisible();
  await page.getByRole("checkbox", { name: "샘플데이터로 표시" }).check();
  const token = (key: string) => surface.locator(`[data-template-tag-value="${key}"]`).first();
  for (const item of cases) {
    await token(item.key).click();
    await expect(page.locator(".examcheck-data-tag-format-backdrop")).toBeVisible();
    const input = page.locator("[data-data-tag-format-input]");
    if (item.key === "candidate.examDate") {
      await page.locator("[data-data-tag-format-preset]").selectOption(item.format);
    } else {
      await page.locator("[data-data-tag-format-preset]").selectOption("__custom__");
      await expect(input).toBeFocused();
      await input.fill("YYYY <script>");
      await expect(page.locator("[data-data-tag-format-apply]")).toBeDisabled();
      await input.fill(item.format);
    }
    await expect(page.locator("[data-data-tag-format-preview]")).toHaveText(item.text);
    await page.locator("[data-data-tag-format-apply]").click();
    await expect(token(item.key)).toHaveText(item.text);
  }
  await expect(surface.locator('[data-template-tag-value="candidate.examDate"]').last()).toHaveText("2026-10-30");
  await surface.focus();
  await page.keyboard.press("Control+z");
  await expect(token("system.printedAt")).toHaveText("2026-09-12 09:30");
  await page.keyboard.press("Control+y");
  await expect(token("system.printedAt")).toHaveText(cases[4].text);
  await token("candidate.examDate").click();
  await page.locator("[data-data-tag-format-preset]").selectOption("");
  await page.locator("[data-data-tag-format-apply]").click();
  await expect(token("candidate.examDate")).toHaveText("2026-10-30");
  await token("candidate.examDate").click();
  await page.locator("[data-data-tag-format-input]").fill("YYYY년 M월 D일");
  await page.keyboard.press("Escape");
  await expect(token("candidate.examDate")).toHaveText("2026-10-30");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect.poll(() => saved).toBe(true);
  await page.reload();
  for (const item of cases.slice(1)) await expect(token(item.key)).toHaveText(item.text);
  const popupReady = page.waitForEvent("popup");
  await page.getByRole("button", { name: "미리보기", exact: true }).click();
  const popup = await popupReady;
  for (const item of cases.slice(1))
    await expect(popup.locator(`[data-template-tag-value="${item.key}"]`)).toHaveText(item.text);
  await popup.close();
  expect(errors).toEqual([]);
});

function templateResponse(path: string, records: unknown[]) {
  return path.endsWith("/summaries") ? records : records[0];
}
