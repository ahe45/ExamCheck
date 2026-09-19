import { expect, test, type Locator, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const DEFAULT_EXAM_NAME = "2026년도 자격시험";
const SETTINGS_ADMISSION = "CI-E2E-SETTINGS-전형";
const WORKFLOW_ADMISSION = "CI-E2E-WORKFLOW-전형";
const WORKFLOW_DATE = "2026-11-01";
const WORKFLOW_TIME = "10:00";
const WORKFLOW_PERIOD = "CI-E2E-WORKFLOW-1교시";
const WORKFLOW_OTHER_PERIOD = "CI-E2E-WORKFLOW-2교시";
const WORKFLOW_CURRENT_EXAMINEE = "CI-E2E-WORKFLOW-001";
const WORKFLOW_BLOCKED_EXAMINEE = "CI-E2E-WORKFLOW-002";
const WORKFLOW_OTHER_EXAMINEE = "CI-E2E-WORKFLOW-003";
const ACCOUNT_LOGIN_ID = "CI-E2E-account";
const ACCOUNT_UPDATED_LOGIN_ID = "CI-E2E-account-updated";

const accounts = {
  admin: { loginId: "admin", password: "1234" },
  operator: { loginId: "가번호", password: "1234" },
} as const;
const executeFile = promisify(execFile);
const fixtureCliPath = resolve(process.cwd(), "e2e/fixture-cli.mjs");

test.describe("FHD 변경 작업 흐름", () => {
  test("라벨 바코드 데이터를 선택하여 삽입하고 저장한다", async ({ page }) => {
    await login(page, accounts.admin);
    await page.getByRole("button", { name: "양식 관리", exact: true }).click();
    await page.getByRole("button", { name: "라벨 양식", exact: true }).click();
    await page.getByRole("button", { name: "새 양식", exact: true }).click();
    await page.getByLabel("양식 제목", { exact: true }).fill("CI-E2E-BARCODE-SOURCE");
    const objects = page.locator(".label-canvas-element");
    await page.getByRole("button", { name: "바코드", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "바코드 데이터" });
    await expect(picker).toBeVisible();
    await expect(objects).toHaveCount(3);
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await page.getByRole("button", { name: "바코드", exact: true }).click();
    await picker.locator("summary").filter({ hasText: "수험생 정보" }).click();
    await picker.getByRole("checkbox", { name: "바코드 값 표시" }).uncheck();
    await expect(picker.getByRole("button", { name: "이름", exact: true })).toHaveCount(0);
    await page.screenshot({ path: "test-results/label-barcode-source-picker.png", fullPage: true });
    await picker.getByRole("button", { name: "수험번호", exact: true }).click();
    await expect(picker).toHaveCount(0);
    await expect(objects).toHaveCount(4);
    const savedResponse = page.waitForResponse(
      (response) => response.url().includes("/label-templates/") && response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "저장", exact: true }).click();
    const saved = await (await savedResponse).json();
    expect(saved.layout.elements.at(-1)).toMatchObject({
      kind: "barcode",
      content: "{{candidate.examNo}}",
      showText: false,
    });
    await expect(page.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    await page.reload();
    await expect(objects).toHaveCount(4);
    await expect(objects.last().locator("small")).toHaveText("");
    await objects.last().dblclick();
    await expect(picker.getByRole("checkbox", { name: "바코드 값 표시" })).not.toBeChecked();
    await picker.getByRole("checkbox", { name: "바코드 값 표시" }).check();
    await picker.locator("summary").filter({ hasText: "수험생 정보" }).click();
    await picker.getByRole("button", { name: "수험번호", exact: true }).click();
    await expect(objects).toHaveCount(4);
    await expect(objects.last()).toContainText("1162001");
    await expect(page.locator(".label-template-tools").getByRole("checkbox", { name: "바코드 값 표시" })).toHaveCount(
      0,
    );
    await expect(page.locator(".label-selection-count")).toHaveCount(0);
  });

  test("문서 바코드 데이터를 선택하여 커서 위치에 삽입하고 저장한다", async ({ page }) => {
    await login(page, accounts.admin);
    await page.getByRole("button", { name: "양식 관리", exact: true }).click();
    await page.getByRole("button", { name: "새 양식", exact: true }).click();
    const information = page.getByRole("dialog", { name: "양식 정보" });
    await information.getByLabel("양식명", { exact: true }).fill("CI-E2E-DOC-BARCODE-SOURCE");
    await information.getByRole("button", { name: "확인", exact: true }).click();
    const surface = page.locator("[data-template-editor-runtime-surface]");
    await surface.click();
    await page.keyboard.type("AB");
    await page.keyboard.press("ArrowLeft");
    const barcodeButton = page.locator('[data-template-insert="barcode"]');
    const picker = page.getByRole("dialog", { name: "바코드 데이터" });
    await barcodeButton.click();
    await expect(picker).toBeVisible();
    await expect(surface.locator('[data-template-object-type="barcode"]')).toHaveCount(0);
    await picker.getByRole("button", { name: "닫기", exact: true }).click();
    await barcodeButton.click();
    await picker.locator("summary").filter({ hasText: "수험생 정보" }).click();
    await page.screenshot({ path: "test-results/document-barcode-source-picker.png", fullPage: true });
    await picker.getByRole("button", { name: "가번호", exact: true }).click();
    const barcode = surface.locator('[data-template-object-type="barcode"]');
    await expect(barcode).toHaveCount(1);
    await expect(barcode).toHaveAttribute("data-template-object-source", "candidate.temporaryNo");
    await surface.focus();
    await page.keyboard.press("Control+z");
    await expect(barcode).toHaveCount(0);
    await page.keyboard.press("Control+y");
    await expect(barcode).toHaveAttribute("data-template-object-source", "candidate.temporaryNo");
    expect(
      await barcode.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element.closest(".template-doc")!);
        range.setEndBefore(element);
        return range.toString().trim();
      }),
    ).toBe("A");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    await page.reload();
    await expect(barcode).toHaveCount(1);
    await expect(barcode).toHaveAttribute("data-template-object-source", "candidate.temporaryNo");
  });

  test("문서 데이터 블록에서도 바코드 데이터를 선택하고 취소 또는 적용한다", async ({ page }) => {
    await login(page, accounts.admin);
    await page.getByRole("button", { name: "양식 관리", exact: true }).click();
    await page.getByRole("button", { name: "새 양식", exact: true }).click();
    await page.getByRole("dialog", { name: "양식 정보" }).getByRole("button", { name: "닫기", exact: true }).click();
    for (const key of ["columns", "rows"]) {
      const input = page.locator(`[data-examlist-block-grid-setting="${key}"]`);
      await input.fill("1");
      await input.press("Tab");
    }
    await page.locator("[data-examlist-block-grid-create]").click();
    const source = page.locator('[data-candidate-block-template-role="source"]').first();
    await source.click();
    const dialog = page.getByRole("dialog", { name: "데이터 블록 편집" });
    const modal = dialog.locator("[data-candidate-block-modal-editor-surface]");
    await modal.fill("AB");
    await modal.press("ArrowLeft");
    await page.locator('[data-template-insert="barcode"]').click();
    const picker = page.getByRole("dialog", { name: "바코드 데이터" });
    await expect(picker).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(modal.locator('[data-template-object-type="barcode"]')).toHaveCount(0);
    await page.locator('[data-template-insert="barcode"]').click();
    await picker.locator("summary").filter({ hasText: "수험생 정보" }).click();
    await picker.getByRole("button", { name: "가번호", exact: true }).click();
    await expect(modal.locator('[data-template-object-type="barcode"]')).toHaveAttribute(
      "data-template-object-source",
      "candidate.temporaryNo",
    );
    await dialog.getByRole("button", { name: "적용", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(source.locator('[data-template-object-type="barcode"]')).toHaveAttribute(
      "data-template-object-source",
      "candidate.temporaryNo",
    );
  });

  test("양식 관리의 문서·라벨 탭과 편집 화면을 새로고침 후 복원한다", async ({ page }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    await login(page, accounts.admin);
    await page.getByRole("button", { name: "양식 관리", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "문서 양식", exact: true })).toHaveClass("active");
    await page.locator(".exam-template-card").first().getByRole("button", { name: "수정", exact: true }).click();
    const title = page.getByLabel("양식 제목", { exact: true });
    const description = page.getByLabel("양식 설명", { exact: true });
    const documentName = await title.inputValue();
    const documentDescription = await description.inputValue();
    await description.fill("새로고침 임시 편집 확인");
    await page.reload();
    await expect(title).toHaveValue(documentName);
    await expect(description).toHaveValue(documentDescription);
    await expect(page.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "양식 목록", exact: true }).click();
    await page.getByRole("button", { name: "라벨 양식", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "라벨 양식", exact: true })).toHaveClass("active");
    await page.getByRole("button", { name: "새 양식", exact: true }).click();
    const paperWidth = page.getByRole("complementary", { name: "용지 설정" }).getByLabel("너비(mm)");
    const defaultWidth = await paperWidth.inputValue();
    await title.fill("CI-E2E-RESTORE-LABEL");
    await description.fill("저장 전 라벨 복원");
    await page.getByRole("complementary", { name: "용지 설정" }).getByLabel("너비(mm)").fill("80");
    await page.reload();
    await expect(title).toHaveValue("");
    await expect(description).toHaveValue("");
    await expect(paperWidth).toHaveValue(defaultWidth);
    await expect(page.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
    await title.fill("CI-E2E-RESTORE-LABEL");
    await description.fill("저장된 설명");
    await paperWidth.fill("80");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("라벨 양식을 저장했습니다");
    await title.fill("저장하지 않은 제목");
    await description.fill("저장하지 않은 설명");
    await paperWidth.fill("90");
    await page.reload();
    await expect(title).toHaveValue("CI-E2E-RESTORE-LABEL");
    await expect(description).toHaveValue("저장된 설명");
    await expect(paperWidth).toHaveValue("80");
    await expect(page.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "양식 목록", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("heading", { name: "라벨 양식 관리" })).toBeVisible();
    await page.getByRole("button", { name: "문서 양식", exact: true }).click();
    await page.reload();
    await expect(page.locator(".exam-template-card").first()).toBeVisible();
  });

  test("라벨 편집기는 제목·설명 아래에 문서 편집기와 같은 네 패널을 배치한다", async ({ page }) => {
    await login(page, accounts.admin);
    await page.getByRole("button", { name: "양식 관리", exact: true }).click();
    // Record the document editor as the visual reference for the shared header and panels.
    await page.locator(".exam-template-card").first().getByRole("button", { name: "수정", exact: true }).click();
    await expect(page.getByLabel("양식 제목", { exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/document-editor-layout-reference.png", fullPage: true });
    await page.getByRole("button", { name: "양식 목록", exact: true }).click();
    await page.getByRole("button", { name: "라벨 양식", exact: true }).click();
    await page.getByRole("button", { name: "새 양식", exact: true }).click();
    await page.getByLabel("양식 제목", { exact: true }).fill("CI-E2E-LABEL-LAYOUT");
    await page.getByLabel("양식 설명", { exact: true }).fill("공통 편집기 레이아웃 확인");
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [2560, 1440],
    ]) {
      await page.setViewportSize({ width: width!, height: height! });
      const columns = page.locator(".label-template-workspace > aside, .label-template-workspace > main");
      await expect(columns).toHaveCount(4);
      const boxes = await columns.evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, height: box.height };
        }),
      );
      for (let index = 0; index < 4; index++) {
        expect(boxes[index]!.height).toBeGreaterThan(300);
        expect(boxes[index]!.y).toBeCloseTo(boxes[0]!.y, 0);
        expect(boxes[index]!.bottom).toBeLessThanOrEqual(height!);
        if (index) expect(boxes[index]!.x).toBeGreaterThanOrEqual(boxes[index - 1]!.right);
      }
      expect(boxes[3]!.right).toBeLessThanOrEqual(width!);
      const title = (await page.getByLabel("양식 제목", { exact: true }).boundingBox())!;
      expect(title.y + title.height).toBeLessThanOrEqual(boxes[0]!.y);
      await expect(
        page.getByRole("complementary", { name: "에디터 툴바" }).getByRole("heading", { name: "선택 요소" }),
      ).toBeVisible();
      await expect(page.getByRole("complementary", { name: "데이터 태그" }).getByRole("searchbox")).toBeVisible();
      await expect(page.getByRole("complementary", { name: "용지 설정" }).getByLabel("해상도")).toBeVisible();
      await page.screenshot({ path: `test-results/label-editor-layout-${width}.png`, fullPage: true });
    }
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("라벨 양식을 저장했습니다");
    await page.getByRole("button", { name: "양식 목록", exact: true }).click();
    const card = page.locator(".label-template-card").filter({ hasText: "CI-E2E-LABEL-LAYOUT" });
    await expect(card).toContainText("공통 편집기 레이아웃 확인");
    await card.getByRole("button", { name: "수정", exact: true }).click();
    await expect(page.getByLabel("양식 설명", { exact: true })).toHaveValue("공통 편집기 레이아웃 확인");
  });

  test("라벨 글자 서식과 개체 크기를 편집하고 Delete로 선택 개체를 삭제한다", async ({ page }) => {
    await login(page, accounts.admin);
    await page.getByRole("button", { name: "양식 관리", exact: true }).click();
    await page.getByRole("button", { name: "라벨 양식", exact: true }).click();
    await page.getByRole("button", { name: "새 양식", exact: true }).click();
    await page.getByLabel("양식 제목", { exact: true }).fill("CI-E2E-LABEL-FORMAT");
    const objects = page.locator(".label-canvas-element");
    const properties = page.locator(".label-template-tools");
    const fields = properties.locator("input, select");
    const positions = await fields.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().y),
    );
    await page.locator(".label-template-canvas").press("Escape");
    await expect(fields).toHaveCount(positions.length);
    for (const field of await fields.all()) await expect(field).toBeDisabled();
    await expect(properties.getByRole("spinbutton", { name: "너비(mm)", exact: true })).toHaveAttribute(
      "placeholder",
      "-",
    );
    await expect(properties.getByLabel("내용", { exact: true })).toHaveCount(0);
    await expect(properties.getByRole("button", { name: "시계 방향 90도 회전", exact: true })).toBeDisabled();
    await expect(properties.getByRole("button", { name: "반시계 방향 90도 회전", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "글꼴 크기 목록 열기" })).toContainText("-mm");
    const emptyPositions = await fields.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().y),
    );
    expect(emptyPositions).toEqual(positions);
    await page.screenshot({ path: "test-results/label-editor-empty-selection.png", fullPage: true });
    await objects.first().click();
    await expect(properties.getByRole("spinbutton", { name: "너비(mm)", exact: true })).toHaveValue("67");
    await page.getByRole("button", { name: "글꼴 크기 목록 열기" }).click();
    await page.getByRole("button", { name: "5mm", exact: true }).click();
    await page.getByRole("button", { name: "오른쪽 정렬", exact: true }).click();
    await expect(objects.first()).toHaveCSS("justify-content", "flex-end");
    await properties.getByRole("spinbutton", { name: "너비(mm)", exact: true }).fill("40");
    await properties.getByRole("spinbutton", { name: "높이(mm)", exact: true }).fill("10");
    await objects.first().click();
    await page.keyboard.press("Control+ArrowRight");
    await page.keyboard.press("ArrowDown");
    await expect(properties.getByLabel("X(mm)", { exact: true })).toHaveValue("4.1");
    await expect(properties.getByLabel("Y(mm)", { exact: true })).toHaveValue("5");
    await page.keyboard.press("Control+ArrowLeft");
    await page.keyboard.press("ArrowUp");
    await expect(properties.getByLabel("X(mm)", { exact: true })).toHaveValue("4");
    await expect(properties.getByLabel("Y(mm)", { exact: true })).toHaveValue("4");
    await page.getByLabel("양식 설명", { exact: true }).fill("서식 확인");
    await page.getByLabel("양식 설명", { exact: true }).press("Home");
    await page.getByLabel("양식 설명", { exact: true }).press("Delete");
    await expect(objects).toHaveCount(3);
    await expect(page.getByRole("button", { name: "선택 요소 삭제" })).toHaveCount(0);
    await page.screenshot({ path: "test-results/label-editor-format-controls.png", fullPage: true });
    const saved = page.waitForResponse(
      (response) => response.url().includes("/label-templates/") && response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "저장", exact: true }).click();
    const savedLayout = (await (await saved).json()).layout;
    expect(savedLayout.elements[0].fontSizeMm).toBe(5);
    expect(savedLayout.elements[0]).toMatchObject({ align: "right", widthMm: 40, heightMm: 10 });
    await page.getByRole("button", { name: "양식 목록", exact: true }).click();
    await page
      .locator(".label-template-card")
      .filter({ hasText: "CI-E2E-LABEL-FORMAT" })
      .getByRole("button", { name: "수정", exact: true })
      .click();
    await expect(page.getByRole("button", { name: "글꼴 크기 목록 열기" })).toContainText("5mm");
    await expect(page.getByRole("button", { name: "오른쪽 정렬", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await objects.first().click();
    await page.keyboard.press("Delete");
    await expect(objects).toHaveCount(2);
    await page.locator(".label-template-canvas").press("Control+a");
    await page.keyboard.press("Delete");
    await expect(objects).toHaveCount(0);
  });

  test("라벨 개체 다중 선택·맞춤·간격·그룹 이동을 저장한다", async ({ page }) => {
    await login(page, accounts.admin);
    await page.getByRole("button", { name: "양식 관리", exact: true }).click();
    await page.getByRole("button", { name: "라벨 양식", exact: true }).click();
    await page.getByRole("button", { name: "새 양식", exact: true }).click();
    const properties = page.locator(".label-template-tools");
    await page.getByLabel("양식 제목", { exact: true }).fill("CI-E2E-ALIGNMENT");
    const width = properties.getByRole("spinbutton", { name: "너비(mm)", exact: true });
    const height = properties.getByRole("spinbutton", { name: "높이(mm)", exact: true });
    const x = properties.getByRole("spinbutton", { name: "X(mm)", exact: true });
    const y = properties.getByRole("spinbutton", { name: "Y(mm)", exact: true });
    await width.fill("20");
    await properties.getByRole("button", { name: "반시계 방향 90도 회전", exact: true }).click();
    await x.fill("4");
    await y.fill("4");
    const objects = page.locator(".label-canvas-element");
    await objects.nth(1).click();
    await width.fill("20");
    await height.fill("6");
    await x.fill("30");
    await y.fill("5");
    await objects.nth(2).click();
    await width.fill("10");
    await height.fill("6");
    await x.fill("60");
    await y.fill("30");
    await objects.nth(0).click({ modifiers: ["Shift"] });
    await expect(page.locator(".label-canvas-element.selected")).toHaveCount(2);
    await objects.nth(1).click({ modifiers: ["Control"] });
    await expect(page.locator(".label-canvas-element.selected")).toHaveCount(3);
    await expect(page.getByRole("combobox", { name: "개체 정렬 기준" })).toHaveCount(0);
    await page.getByRole("button", { name: "맞춤 정렬 메뉴 열기" }).click();
    await page.getByRole("button", { name: "위쪽 맞춤", exact: true }).click();
    await page.getByRole("button", { name: "간격 정렬 메뉴 열기" }).click();
    await page.getByRole("button", { name: "가로 간격 동일", exact: true }).click();
    const arranged = await objects.evaluateAll((elements) =>
      elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
    await page.getByRole("button", { name: "맞춤 정렬 메뉴 열기" }).click();
    await page.getByRole("button", { name: "세로 가운데", exact: true }).click();
    const before = await objects.evaluateAll((elements) =>
      elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
    for (const index of [1, 2]) {
      expect(before[index]!.y - before[0]!.y).toBeCloseTo(arranged[index]!.y - arranged[0]!.y, 0);
      expect(before[index]!.x - before[0]!.x).toBeCloseTo(arranged[index]!.x - arranged[0]!.x, 0);
    }
    expect(before[1]!.x - before[0]!.x - before[0]!.width).toBeCloseTo(
      before[2]!.x - before[1]!.x - before[1]!.width,
      0,
    );
    const canvas = (await page.locator(".label-template-canvas").boundingBox())!;
    const groupTop = Math.min(...before.map((item) => item.y));
    const groupBottom = Math.max(...before.map((item) => item.y + item.height));
    expect((groupTop + groupBottom) / 2).toBeCloseTo(canvas.y + canvas.height / 2, 0);
    await page.mouse.move(before[0]!.x + before[0]!.width / 2, before[0]!.y + before[0]!.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width + 100, canvas.y + canvas.height + 100, { steps: 5 });
    await page.mouse.up();
    const after = await objects.evaluateAll((elements) =>
      elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
    for (const index of [1, 2]) {
      expect(after[index]!.x - after[0]!.x).toBeCloseTo(before[index]!.x - before[0]!.x, 0);
      expect(after[index]!.y - after[0]!.y).toBeCloseTo(before[index]!.y - before[0]!.y, 0);
    }
    expect(after[2]!.x + after[2]!.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    await page.screenshot({ path: "test-results/label-object-alignment.png", fullPage: true });
    const saved = page.waitForResponse(
      (response) => response.url().includes("/label-templates/") && response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "저장", exact: true }).click();
    const savedLayout = (await (await saved).json()).layout;
    expect(savedLayout.elements.map((element: { xMm: number; yMm: number }) => [element.xMm, element.yMm])).toEqual([
      [9, 13],
      [33, 14],
      [65, 39],
    ]);
    await expect(page.getByRole("status")).toContainText("라벨 양식을 저장했습니다");
    await page.getByRole("button", { name: "양식 목록", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "라벨 양식", exact: true }).click();
    await page
      .locator(".label-template-card")
      .filter({ hasText: "CI-E2E-ALIGNMENT" })
      .getByRole("button", { name: "수정", exact: true })
      .click();
    await expect(x).toHaveValue("9");
    await expect(y).toHaveValue("13");
    await page.getByRole("button", { name: "맞춤 정렬 메뉴 열기" }).click();
    await page.getByRole("button", { name: "가로 가운데", exact: true }).click();
    await expect(x).toHaveValue("31.5");
    await page.locator(".label-template-canvas").press("Control+a");
    await page.getByRole("button", { name: "맞춤 정렬 메뉴 열기" }).click();
    await page.getByRole("button", { name: "아래쪽 맞춤", exact: true }).click();
    const bottoms = await objects.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().bottom),
    );
    expect(Math.max(...bottoms)).toBeCloseTo(canvas.y + canvas.height - 1, 0);
    expect(bottoms[2]! - bottoms[0]!).toBeCloseTo(((45 - 33) * (canvas.height - 2)) / 45, 0);
    expect(bottoms[2]! - bottoms[1]!).toBeCloseTo(((45 - 20) * (canvas.height - 2)) / 45, 0);
    await page.locator(".label-template-canvas").press("Escape");
    await expect(page.getByRole("button", { name: "맞춤 정렬 메뉴 열기" })).toBeDisabled();
  });

  test("라벨 개체를 모두 선택하여 양방향 90도 회전하고 저장한다", async ({ page }) => {
    await login(page, accounts.admin);
    await page.getByRole("button", { name: "양식 관리", exact: true }).click();
    await page.getByRole("button", { name: "라벨 양식", exact: true }).click();
    await page.getByRole("button", { name: "새 양식", exact: true }).click();
    await page.getByLabel("양식 제목", { exact: true }).fill("CI-E2E-MULTI-ROTATION");
    const canvas = page.locator(".label-template-canvas");
    await canvas.press("Control+a");
    const selected = page.locator(".label-canvas-element.selected");
    await expect(selected).toHaveCount(3);
    await page.getByRole("button", { name: "시계 방향 90도 회전", exact: true }).click();
    for (const element of await selected.all()) await expect(element).toHaveCSS("transform", /matrix\(0, 1, -1, 0,/);
    await page.getByRole("button", { name: "반시계 방향 90도 회전", exact: true }).click();
    for (const element of await selected.all()) await expect(element).toHaveCSS("transform", "none");
    await page.getByRole("button", { name: "반시계 방향 90도 회전", exact: true }).click();
    const savedResponse = page.waitForResponse(
      (response) => response.url().includes("/label-templates/") && response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "저장", exact: true }).click();
    const saved = await (await savedResponse).json();
    expect(saved.layout.elements.map((element: { rotation: number }) => element.rotation)).toEqual([270, 270, 270]);
    await expect(page.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.locator(".label-canvas-element")).toHaveCount(3);
    for (const element of await page.locator(".label-canvas-element").all())
      await expect(element).toHaveCSS("transform", /matrix\(0, -1, 1, 0,/);
  });

  for (const rotation of [90, 270]) {
    test(`라벨 개체 ${rotation}도 회전·이동·출력 데이터·저장 유지`, async ({ page }) => {
      await login(page, accounts.admin);
      await page.getByRole("button", { name: "양식 관리", exact: true }).click();
      await page.getByRole("button", { name: "라벨 양식", exact: true }).click();
      await page.getByRole("button", { name: "새 양식", exact: true }).click();
      const properties = page.locator(".label-template-tools");
      const templateName = `CI-E2E-ROTATION-${rotation}`;
      await page.getByLabel("양식 제목", { exact: true }).fill(templateName);
      await properties.getByRole("spinbutton", { name: "너비(mm)", exact: true }).fill("30");
      await properties.getByRole("spinbutton", { name: "Y(mm)", exact: true }).fill("20");
      const beforeRotation = (await page.locator(".label-canvas-element.selected").boundingBox())!;
      await properties
        .getByRole("button", { name: rotation === 90 ? "시계 방향 90도 회전" : "반시계 방향 90도 회전", exact: true })
        .click();
      const canvas = page.locator(".label-template-canvas");
      const selected = page.locator(".label-canvas-element.selected");
      const canvasBox = (await canvas.boundingBox())!;
      const originalBox = (await selected.boundingBox())!;
      // 30 x 12 mm becomes 12 x 30 mm; use the canvas content size (excluding its border).
      const scale = (canvasBox.width - 2) / 75;
      expect(originalBox.width).toBeCloseTo(12 * scale, 0);
      expect(originalBox.height).toBeCloseTo(30 * scale, 0);
      expect(originalBox.x + originalBox.width / 2).toBeCloseTo(beforeRotation.x + beforeRotation.width / 2, 0);
      expect(originalBox.y + originalBox.height / 2).toBeCloseTo(beforeRotation.y + beforeRotation.height / 2, 0);
      expect(originalBox.x - canvasBox.x - 1).toBeCloseTo(13 * scale, 0);
      // Grab above the existing barcode so overlapping elements do not change the selection.
      await page.mouse.move(originalBox.x + originalBox.width / 2, originalBox.y + originalBox.height / 5);
      await page.mouse.down();
      await page.mouse.move(canvasBox.x + canvasBox.width + 80, canvasBox.y + canvasBox.height + 80, { steps: 5 });
      await page.mouse.up();
      await expect(properties.getByRole("spinbutton", { name: "X(mm)", exact: true })).toHaveValue("63");
      await expect(properties.getByRole("spinbutton", { name: "Y(mm)", exact: true })).toHaveValue("15");
      const movedBox = (await selected.boundingBox())!;
      expect(movedBox.x + movedBox.width).toBeLessThanOrEqual(canvasBox.x + canvasBox.width);
      expect(movedBox.y + movedBox.height).toBeLessThanOrEqual(canvasBox.y + canvasBox.height);

      const previewResponse = page.waitForResponse(
        (response) => response.url().endsWith("/label-templates/preview") && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "테스트 출력", exact: true }).click();
      const preview = await (await previewResponse).json();
      expect(preview.samplePayload).toContain(`^A0${rotation === 90 ? "R" : "B"},`);
      await expect(page.getByRole("status")).toContainText("프린터로 전송했습니다");
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("라벨 양식을 저장했습니다");
      await page.getByRole("button", { name: "양식 목록", exact: true }).click();
      await page.reload();
      await page.getByRole("button", { name: "라벨 양식", exact: true }).click();
      const card = page.locator(".label-template-card").filter({ hasText: templateName });
      const thumbnail = card.locator(".label-template-thumbnail-element").first();
      await expect(thumbnail).toHaveCSS("transform", rotation === 90 ? /matrix\(0, 1, -1, 0,/ : /matrix\(0, -1, 1, 0,/);
      await card.getByRole("button", { name: "수정", exact: true }).click();
      await expect(selected).toHaveCSS("transform", rotation === 90 ? /matrix\(0, 1, -1, 0,/ : /matrix\(0, -1, 1, 0,/);
      await page.screenshot({ path: `test-results/label-rotation-${rotation}.png`, fullPage: true });
    });
  }

  test("결시 가번호 등록, 고정 유지, 관리자 표시 설정을 검증한다", async ({ page }) => {
    await resetOperationFixture();
    await login(page, accounts.operator);
    await page
      .locator(".operation-schedule-card")
      .filter({ hasText: WORKFLOW_ADMISSION })
      .filter({ hasText: WORKFLOW_PERIOD })
      .click();
    const selector = page.getByRole("group", { name: "등록 상태", exact: true });
    await expect(selector).toBeVisible();
    await expect(selector.getByRole("button", { name: "응시", exact: true })).toHaveAttribute("aria-pressed", "true");
    const examineeInput = page.getByRole("textbox", { name: "수험번호" });
    const lockOption = selector.locator('input[type="checkbox"]');
    await examineeInput.focus();
    await examineeInput.hover();
    await expect(lockOption).toBeHidden();
    await selector.hover();
    await expect(lockOption).toBeVisible();
    await page.screenshot({ path: "test-results/attendance-lock-popover.png", fullPage: true });
    await examineeInput.hover();
    await expect(lockOption).toBeHidden();
    await selector.getByRole("button", { name: "응시", exact: true }).focus();
    await expect(lockOption).toBeVisible();
    await selector.getByRole("button", { name: "결시", exact: true }).click();
    await searchExaminee(examineeInput, WORKFLOW_CURRENT_EXAMINEE);
    await examineeInput.hover();
    await expect(lockOption).toBeVisible();
    const assignmentDialog = page.getByRole("dialog", { name: "가번호 순차부여" });
    await expect(assignmentDialog).toContainText("결시로 등록");
    await assignmentDialog.getByRole("button", { name: "저장", exact: true }).click();
    await expect(operationRow(page, WORKFLOW_CURRENT_EXAMINEE)).toContainText("결시");
    await expect(selector.getByRole("button", { name: "응시", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(assignmentDialog).toHaveCount(0);

    await selector.hover();
    await selector.getByRole("checkbox", { name: "고정", exact: true }).click();
    await examineeInput.focus();
    await examineeInput.hover();
    await expect(lockOption).toBeVisible();
    await selector.getByRole("button", { name: "결시", exact: true }).click();
    await searchExaminee(examineeInput, WORKFLOW_BLOCKED_EXAMINEE);
    await assignmentDialog.getByRole("button", { name: "저장", exact: true }).click();
    await expect(operationRow(page, WORKFLOW_BLOCKED_EXAMINEE)).toContainText("결시");
    await expect(selector.getByRole("checkbox", { name: "고정", exact: true })).toBeChecked();
    await page.reload();
    await expect(operationRow(page, WORKFLOW_CURRENT_EXAMINEE)).toContainText("결시");
    await expect(operationRow(page, WORKFLOW_BLOCKED_EXAMINEE)).toContainText("결시");
    await page.screenshot({ path: "test-results/attendance-operator.png", fullPage: true });

    await page.getByRole("button", { name: "로그아웃" }).click();
    await login(page, accounts.admin);
    await page.getByRole("button", { name: "시스템 설정", exact: true }).click();
    await page.locator(".admission-settings-card").filter({ hasText: WORKFLOW_ADMISSION }).click();
    const editor = page.getByRole("dialog", { name: `${WORKFLOW_ADMISSION} 전형 설정` });
    await editor.getByRole("checkbox", { name: /응시·결시 선택 표시/ }).uncheck({ force: true });
    await editor.getByRole("button", { name: "설정 저장" }).click();
    await expect(page.getByRole("status")).toContainText("시스템 설정을 저장했습니다");
    await editor.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("button", { name: "로그아웃" }).click();
    await login(page, accounts.operator);
    await page
      .locator(".operation-schedule-card")
      .filter({ hasText: WORKFLOW_ADMISSION })
      .filter({ hasText: WORKFLOW_PERIOD })
      .click();
    await expect(page.getByRole("button", { name: "수험자 검색" })).toBeVisible();
    await expect(operationRow(page, WORKFLOW_CURRENT_EXAMINEE)).toContainText("결시");
    await expect(selector).toHaveCount(0);
  });

  test("잘못된 XLSX 양식 오류를 미리보기 영역에 표시한다", async ({ page }) => {
    await login(page, accounts.admin);
    await page.getByRole("button", { name: "수험생 데이터", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/candidates$/);
    await page.getByRole("button", { name: "데이터 업로드", exact: true }).click();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("CI-E2E-잘못된-양식");
    sheet.addRow(["CI-E2E-예상하지-않은-컬럼", "CI-E2E-데이터"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const dialog = page.getByRole("dialog", { name: "데이터 업로드" });
    await dialog.locator('input[type="file"][accept=".xlsx"]').setInputFiles({
      name: "CI-E2E-invalid-template.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    });

    const inlineError = page.getByRole("alert");
    await expect(inlineError).toBeVisible();
    await expect(inlineError).toContainText("수험생 업로드 양식과 일치하지 않습니다");
    await expect(inlineError).not.toContainText("Unexpected token");
    await expect(dialog.getByRole("button", { name: "업로드 실행" })).toBeDisabled();
  });

  test("계정을 생성하고 수정한 뒤 비활성화한다", async ({ page }) => {
    await resetAccountFixture();
    await login(page, accounts.admin);
    await page.getByRole("button", { name: "계정 관리", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/accounts$/);

    await page.getByRole("button", { name: "계정 생성", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "계정 생성" });
    await dialog.getByLabel("아이디").fill(ACCOUNT_LOGIN_ID);
    await dialog.getByLabel("비밀번호", { exact: true }).fill("1234");
    await dialog.getByLabel("비밀번호 확인").fill("1234");
    await dialog.getByRole("checkbox", { name: SETTINGS_ADMISSION }).check();
    await dialog.getByRole("button", { name: "계정 생성", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("새 계정이 생성되었습니다");

    let row = accountRow(page, ACCOUNT_LOGIN_ID);
    await expect(row).toContainText(SETTINGS_ADMISSION);
    await row.getByRole("button", { name: "수정" }).click();
    dialog = page.getByRole("dialog", { name: "계정 수정" });
    await dialog.getByLabel("아이디").fill(ACCOUNT_UPDATED_LOGIN_ID);
    await dialog.locator(".account-role-section button").filter({ hasText: "관리자" }).click();
    await dialog.getByRole("button", { name: "변경사항 저장" }).click();
    await expect(page.getByRole("status")).toContainText("계정 정보가 수정되었습니다");

    row = accountRow(page, ACCOUNT_UPDATED_LOGIN_ID);
    await expect(row).toContainText("관리자");
    await expect(row).toContainText("전체 전형·교시");
    await row.getByRole("button", { name: "삭제" }).click();
    const deleteDialog = page.getByRole("dialog", { name: "계정을 삭제하시겠습니까?" });
    await expect(deleteDialog).toContainText(ACCOUNT_UPDATED_LOGIN_ID);
    await deleteDialog.getByRole("button", { name: "계정 삭제" }).click();
    await expect(page.getByRole("status")).toContainText("계정이 삭제되었습니다");
    await expect(accountRow(page, ACCOUNT_UPDATED_LOGIN_ID)).toHaveCount(0);
  });

  test("전형 설정의 변경사항을 취소하고 버린 뒤 저장한다", async ({ page }) => {
    await resetSettingsFixture();
    await login(page, accounts.admin);
    await page.getByRole("button", { name: "시스템 설정", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/settings$/);

    await openSettingsEditor(page);
    let editor = settingsEditor(page);
    await editor.screenshot({ path: "test-results/assignment-method-height.png" });
    let photoSwitch = editor.getByRole("checkbox", { name: /수험생 사진 사용/ });
    await expect(photoSwitch).toBeChecked();
    await photoSwitch.click({ force: true });
    const saveButton = editor.getByRole("button", { name: "설정 저장" });
    await expect(saveButton).toBeEnabled();
    await expect(saveButton).toHaveClass(/exam-outline-button/);

    await editor.getByRole("button", { name: "닫기", exact: true }).click();
    let confirmation = page.getByRole("alertdialog", { name: /전형 설정을 저장하시겠습니까/ });
    await confirmation.getByRole("button", { name: "취소", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(photoSwitch).not.toBeChecked();

    await editor.getByRole("button", { name: "닫기", exact: true }).click();
    confirmation = page.getByRole("alertdialog", { name: /전형 설정을 저장하시겠습니까/ });
    await confirmation.getByRole("button", { name: "저장 안 함", exact: true }).click();
    await expect(editor).toHaveCount(0);

    await openSettingsEditor(page);
    editor = settingsEditor(page);
    photoSwitch = editor.getByRole("checkbox", { name: /수험생 사진 사용/ });
    await expect(photoSwitch).toBeChecked();
    await photoSwitch.click({ force: true });
    await editor.getByRole("button", { name: "닫기", exact: true }).click();
    confirmation = page.getByRole("alertdialog", { name: /전형 설정을 저장하시겠습니까/ });
    await confirmation.getByRole("button", { name: "저장", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await openSettingsEditor(page);
    editor = settingsEditor(page);
    await expect(editor.getByRole("checkbox", { name: /수험생 사진 사용/ })).not.toBeChecked();
    await editor.getByRole("button", { name: "닫기", exact: true }).click();
  });

  test("개발자 번호 유일 정책을 저장하고 재조회한다", async ({ page }) => {
    await resetDeveloperPolicyFixture();
    await login(page, { loginId: "dev", password: "1234" });
    await page.getByRole("button", { name: "개발자", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/developer$/);

    let examineePolicy = page.getByRole("group", { name: "수험번호 유일 정책" });
    let pseudonymPolicy = page.getByRole("group", { name: "가번호 유일 정책" });
    await expect(examineePolicy.getByRole("radio", { name: /시스템 전체/ })).toBeChecked();
    await expect(pseudonymPolicy.getByRole("radio", { name: /전형 전체/ })).toBeChecked();
    await examineePolicy.getByRole("radio", { name: /교시별/ }).click({ force: true });
    await pseudonymPolicy.getByRole("radio", { name: /교시별/ }).click({ force: true });
    await page.getByRole("button", { name: "설정 저장" }).click();
    await expect(page.getByRole("status")).toContainText("시스템 설정이 저장되었습니다");

    await page.reload();
    examineePolicy = page.getByRole("group", { name: "수험번호 유일 정책" });
    pseudonymPolicy = page.getByRole("group", { name: "가번호 유일 정책" });
    await expect(examineePolicy.getByRole("radio", { name: /교시별/ })).toBeChecked();
    await expect(pseudonymPolicy.getByRole("radio", { name: /교시별/ })).toBeChecked();

    await examineePolicy.getByRole("radio", { name: /시스템 전체/ }).click({ force: true });
    await pseudonymPolicy.getByRole("radio", { name: /전형 전체/ }).click({ force: true });
    await page.getByRole("button", { name: "설정 저장" }).click();
    await expect(page.getByRole("status")).toContainText("시스템 설정이 저장되었습니다");
    await page.reload();
    examineePolicy = page.getByRole("group", { name: "수험번호 유일 정책" });
    pseudonymPolicy = page.getByRole("group", { name: "가번호 유일 정책" });
    await expect(examineePolicy.getByRole("radio", { name: /시스템 전체/ })).toBeChecked();
    await expect(pseudonymPolicy.getByRole("radio", { name: /전형 전체/ })).toBeChecked();
  });

  test("교시 확인, 순차부여, 마감 차단과 인쇄 활성화를 검증한다", async ({ page, request }) => {
    await resetOperationFixture();
    await login(page, accounts.operator);
    const scheduleCard = page
      .locator(".operation-schedule-card")
      .filter({ hasText: WORKFLOW_ADMISSION })
      .filter({ hasText: WORKFLOW_PERIOD });
    await expect(scheduleCard).toHaveCount(1);
    await scheduleCard.click();
    await expect(page).toHaveURL(/\/operation$/);

    const examineeInput = page.getByRole("textbox", { name: "수험번호" });
    await searchExaminee(examineeInput, WORKFLOW_OTHER_EXAMINEE);
    const mismatch = page.getByRole("alertdialog", { name: "다른 교시에 배정된 수험생입니다." });
    await expect(mismatch).toContainText(WORKFLOW_OTHER_PERIOD);
    await expect(mismatch).toContainText("CI-E2E-WORKFLOW-고사건물-B");
    await mismatch.getByRole("button", { name: "확인", exact: true }).click();

    await searchExaminee(examineeInput, "CI-E2E-NOT-FOUND");
    await expect(page.getByRole("alert")).toContainText("존재하지 않는 수험번호입니다");

    await searchExaminee(examineeInput, WORKFLOW_CURRENT_EXAMINEE);
    await expect(page.locator(".operator-candidate-preview")).toContainText("CI-E2E-가상수험생-A");
    const assignmentDialog = page.getByRole("dialog", { name: "가번호 순차부여" });
    await expect(assignmentDialog.getByRole("textbox", { name: "가번호", exact: true })).toHaveValue("7001");
    const assignButton = assignmentDialog.getByRole("button", { name: "저장", exact: true });
    await expect(assignButton).toBeEnabled();
    await assignButton.click();
    await expect(page.getByRole("status")).toContainText("가번호가 정상적으로 부여되었습니다");
    await expect(operationRow(page, WORKFLOW_CURRENT_EXAMINEE)).toContainText("7001");
    await expect(assignmentDialog).toHaveCount(0);

    const token = await page.evaluate(() => {
      const stored = sessionStorage.getItem("examcheck.session");
      return stored ? (JSON.parse(stored) as { token?: string }).token || "" : "";
    });
    expect(token).not.toBe("");

    await page.getByRole("button", { name: "운영 마감", exact: true }).click();
    const finishDialog = page.getByRole("alertdialog", { name: "가번호 등록을 마감하시겠습니까?" });
    await finishDialog.getByRole("button", { name: "운영 마감", exact: true }).click();
    await expect(page.getByRole("button", { name: "마감 취소" })).toBeEnabled();

    const printButton = page.getByRole("button", { name: "인쇄", exact: true });
    await expect(printButton).toBeEnabled();
    await searchExaminee(examineeInput, WORKFLOW_BLOCKED_EXAMINEE);
    await expect(page.locator(".operator-candidate-preview")).toContainText("CI-E2E-가상수험생-B");
    await expect(assignmentDialog).toHaveCount(0);

    const blockedResponse = await request.post(`${apiBaseUrl()}/pseudonyms/assignments`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        examineeNo: WORKFLOW_BLOCKED_EXAMINEE,
        mode: "SEQUENTIAL",
        examName: DEFAULT_EXAM_NAME,
        examDate: WORKFLOW_DATE,
        examTime: WORKFLOW_TIME,
        periodName: WORKFLOW_PERIOD,
        admissionName: WORKFLOW_ADMISSION,
      },
    });
    expect(blockedResponse.status()).toBe(409);
    expect((await blockedResponse.json()) as { message: string }).toMatchObject({
      message: expect.stringContaining("마감"),
    });

    await printButton.click();
    const printDialog = page.getByRole("dialog", { name: "인쇄 양식 선택" });
    await expect(printDialog).toBeVisible();
    await expect(printDialog.locator(".operator-print-template-list label").first()).toBeVisible();
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

function accountRow(page: Page, loginId: string) {
  return page.locator(".account-data-table tbody tr").filter({ hasText: loginId });
}

function operationRow(page: Page, examineeNo: string) {
  return page.locator(".operator-roster-table tbody tr").filter({ hasText: examineeNo });
}

function settingsEditor(page: Page) {
  return page.getByRole("dialog", { name: `${SETTINGS_ADMISSION} 전형 설정` });
}

async function openSettingsEditor(page: Page) {
  const card = page.locator(".admission-settings-card").filter({ hasText: SETTINGS_ADMISSION });
  await expect(card).toHaveCount(1);
  await card.click();
  await expect(settingsEditor(page)).toBeVisible();
}

async function searchExaminee(input: Locator, examineeNo: string) {
  await input.fill(examineeNo);
  await input.press("Enter");
}

function apiBaseUrl() {
  const port = Number(process.env.E2E_API_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid isolated E2E API port.");
  return `http://127.0.0.1:${port}/api/v1`;
}

async function resetAccountFixture() {
  await runFixtureReset("reset-account");
}

async function resetSettingsFixture() {
  await runFixtureReset("reset-settings");
}

async function resetDeveloperPolicyFixture() {
  await runFixtureReset("reset-developer");
}

async function resetOperationFixture() {
  await runFixtureReset("reset-operation");
}

async function runFixtureReset(command: "reset-account" | "reset-settings" | "reset-developer" | "reset-operation") {
  await executeFile(process.execPath, [fixtureCliPath, command], {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
  });
}
