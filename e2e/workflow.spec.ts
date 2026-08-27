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

    const inlineError = dialog.locator(".candidate-upload-preview-error");
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
    let photoSwitch = editor.getByRole("checkbox", { name: /수험생 사진 사용/ });
    await expect(photoSwitch).toBeChecked();
    await photoSwitch.click({ force: true });
    await expect(editor.getByRole("button", { name: "설정 저장" })).toBeEnabled();

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
    const assignButton = page.getByRole("button", { name: "다음 가번호 부여" });
    await expect(assignButton).toBeEnabled();
    await assignButton.click();
    await expect(page.getByRole("status")).toContainText("가번호가 정상적으로 부여되었습니다");
    await expect(operationRow(page, WORKFLOW_CURRENT_EXAMINEE)).toContainText("7001");

    const token = await page.evaluate(() => {
      const stored = sessionStorage.getItem("examcheck.session");
      return stored ? (JSON.parse(stored) as { token?: string }).token || "" : "";
    });
    expect(token).not.toBe("");

    await page.getByRole("button", { name: "등록 완료(마감)", exact: true }).click();
    const finishDialog = page.getByRole("alertdialog", { name: "가번호 등록을 마감하시겠습니까?" });
    await finishDialog.getByRole("button", { name: "등록 완료(마감)", exact: true }).click();
    await expect(page.getByRole("button", { name: "등록 마감 완료" })).toBeDisabled();

    const printButton = page.getByRole("button", { name: "인쇄", exact: true });
    await expect(printButton).toBeEnabled();
    await searchExaminee(examineeInput, WORKFLOW_BLOCKED_EXAMINEE);
    await expect(page.locator(".operator-candidate-preview")).toContainText("CI-E2E-가상수험생-B");
    await expect(page.getByRole("button", { name: "다음 가번호 부여" })).toBeDisabled();

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
