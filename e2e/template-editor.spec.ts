import { expect, test, type Locator, type Page } from "@playwright/test";

test.describe("양식 편집기 핵심 실제 브라우저 흐름", () => {
  test("데이터블록 초안 취소·표 삽입 적용·8개 핸들 이동/크기 조절을 검증한다", async ({ page }, testInfo) => {
    await loginAsAdmin(page);
    await page.goto("/admin/templates");
    const firstCard = page.locator(".exam-template-card").first();
    await expect(firstCard).toBeVisible();

    const openedAt = Date.now();
    await firstCard.getByRole("button", { name: "수정", exact: true }).click();
    await expect(page.getByLabel("양식 제목")).toBeVisible();
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
    const initialBox = await appliedGrid.boundingBox();
    const resizeHandle = appliedGrid.locator('[data-candidate-block-grid-resize-corner="bottom-right"]');
    const resizeBox = await resizeHandle.boundingBox();
    if (!initialBox || !resizeBox) throw new Error("데이터블록 크기 조절 위치를 확인할 수 없습니다.");
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeBox.x - 80, resizeBox.y - 50, { steps: 4 });
    await page.mouse.up();
    const resizedBox = await appliedGrid.boundingBox();
    if (!resizedBox) throw new Error("조절된 데이터블록 크기를 확인할 수 없습니다.");
    expect(resizedBox.width).toBeLessThan(initialBox.width);

    const moveHandle = appliedGrid.locator("[data-candidate-block-grid-move-handle]");
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
    const titleInput = page.getByLabel("양식 제목");
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
  const box = await grid.boundingBox();
  if (!box) throw new Error("데이터블록 외곽선 위치를 확인할 수 없습니다.");
  await page.mouse.click(box.x + 1, box.y + box.height / 2);
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
