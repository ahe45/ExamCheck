import { expect, test } from "@playwright/test";

test("applies developer classification to system settings and user permissions", async ({ page, request }) => {
  const api = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
  const adminLogin = await request.post(`${api}/auth/login`, { data: { loginId: "admin", password: "1234" } });
  const admin = { Authorization: `Bearer ${(await adminLogin.json()).token}` };
  const developerLogin = await request.post(`${api}/auth/login`, { data: { loginId: "dev", password: "1234" } });
  const developer = { Authorization: `Bearer ${(await developerLogin.json()).token}` };
  const profileResponse = await request.get(`${api}/developer-settings`, { headers: developer });
  expect(profileResponse.ok()).toBeTruthy();
  const profile = await profileResponse.json();
  const profileInput = {
    schoolName: profile.schoolName,
    academicYear: profile.academicYear,
    systemName: profile.systemName,
  };
  let accountId: number | undefined;
  try {
    await page.goto("/");
    await page.getByLabel("아이디").fill("dev");
    await page.getByLabel("비밀번호", { exact: true }).fill("1234");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.getByRole("button", { name: "개발자", exact: true }).click();
    const selector = page.getByRole("combobox", { name: /분류 방법/ });
    await expect(selector.locator("option")).toHaveCount(10);
    await selector.selectOption("BUILDING");
    await page.getByRole("button", { name: "설정 저장", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("시스템 설정이 저장되었습니다.");
    await page.reload();
    await expect(selector).toHaveValue("BUILDING");

    const scopesResponse = await request.get(`${api}/accounts/classification-scopes`, { headers: admin });
    expect(scopesResponse.ok()).toBeTruthy();
    const { method, scopes } = (await scopesResponse.json()) as {
      method: string;
      scopes: { key: string; label: string }[];
    };
    expect(method).toBe("BUILDING");
    expect(scopes.length).toBeGreaterThan(1);
    const [allowed, forbidden] = scopes;
    await page.getByRole("button", { name: "시스템 설정", exact: true }).click();
    await page.getByRole("button", { name: `${allowed.label} 설정 열기` }).click();
    const editor = page.getByRole("dialog", { name: `${allowed.label} 설정` });
    await editor.locator("label.assignment-method-row-choice").filter({ hasText: "순차부여" }).click();
    await editor.getByText("수험생 사진 사용", { exact: true }).click();
    await editor.getByRole("button", { name: "설정 저장", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("시스템 설정을 저장했습니다.");
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);

    const batchButton = page.getByRole("button", { name: "일괄 설정", exact: true });
    const refreshButton = page.getByRole("button", { name: "새로고침", exact: true });
    const batchBounds = (await batchButton.boundingBox())!;
    expect(batchBounds.x + batchBounds.width).toBeLessThanOrEqual((await refreshButton.boundingBox())!.x);
    await batchButton.click();
    const batchEditor = page.getByRole("dialog", { name: "전체 항목 일괄 설정" });
    await batchEditor.getByText("수험생 사진 사용", { exact: true }).click();
    await batchEditor.getByRole("button", { name: "전체 항목에 저장" }).click();
    await expect(page.getByRole("status")).toContainText(`${scopes.length}개 항목의 설정을 저장했습니다.`);
    await page.keyboard.press("Escape");
    await expect(batchEditor).toHaveCount(0);
    await refreshButton.click();
    await expect(page.locator(".admission-settings-card .admission-setting-method strong")).toHaveText(
      scopes.map(() => "순차부여"),
    );

    const created = await request.post(`${api}/accounts`, {
      headers: admin,
      data: {
        loginId: "classification-e2e",
        password: "test-password",
        role: "USER",
        classificationMethod: "BUILDING",
        admissionNames: [allowed.key],
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    accountId = (await created.json()).id;
    await page.getByRole("button", { name: "계정 관리", exact: true }).click();
    const accountRow = page.getByRole("row", { name: /classification-e2e/ });
    await expect(accountRow.getByText(allowed.label, { exact: true })).toBeVisible();
    await accountRow.getByRole("button", { name: "수정", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: new RegExp(allowed.label) })).toBeChecked();
    const login = await request.post(`${api}/auth/login`, {
      data: { loginId: "classification-e2e", password: "test-password" },
    });
    const operator = { Authorization: `Bearer ${(await login.json()).token}` };
    const schedules = await request.get(`${api}/examinees/operation/schedules`, { headers: operator });
    expect(schedules.ok()).toBeTruthy();
    const rows = (await schedules.json()) as {
      date: string;
      time: string;
      periodName: string;
      admissionName: string;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.admissionName === allowed.key)).toBeTruthy();
    const [{ date, time, periodName, admissionName }] = rows;
    const roster = await request.get(`${api}/examinees/operation/roster`, {
      headers: operator,
      params: { date, time, periodName, admissionName },
    });
    expect(roster.ok()).toBeTruthy();
    const candidates = (await roster.json()) as {
      id: number;
      examineeNo: string;
      assignedNumber: string | null;
    }[];
    const candidate = candidates.find(({ assignedNumber }) => !assignedNumber);
    expect(candidate).toBeDefined();
    const operationScope = { examName: "2026년도 자격시험", examDate: date, examTime: time, periodName, admissionName };
    const assignmentInput = { ...operationScope, mode: "SEQUENTIAL", examineeNo: candidate!.examineeNo };
    const previews = await Promise.all(
      [0, 1].map(() =>
        request.post(`${api}/pseudonyms/assignments/preview`, { headers: operator, data: assignmentInput }),
      ),
    );
    for (const preview of previews) expect(preview.ok(), await preview.text()).toBeTruthy();
    const assigned = await request.post(`${api}/pseudonyms/assignments`, {
      headers: operator,
      data: assignmentInput,
    });
    expect(assigned.ok(), await assigned.text()).toBeTruthy();
    const cleared = await request.delete(`${api}/pseudonyms/operations/candidate-history`, {
      headers: operator,
      data: {
        ...operationScope,
        mode: "ASSIGNMENT",
        candidateRecordId: candidate!.id,
        examineeNo: candidate!.examineeNo,
      },
    });
    expect(cleared.ok(), await cleared.text()).toBeTruthy();
    const denied = await request.get(`${api}/pseudonyms/setting`, {
      headers: operator,
      params: { examName: "2026년도 자격시험", admissionName: forbidden.key },
    });
    expect(denied.status()).toBe(403);

    const unclassified = await request.put(`${api}/developer-settings`, {
      headers: developer,
      data: { ...profileInput, classificationMethod: "NONE" },
    });
    expect(unclassified.ok()).toBeTruthy();
    const blocked = await request.get(`${api}/examinees/operation/schedules`, { headers: operator });
    expect(await blocked.json()).toEqual([]);
    const overview = await request.get(`${api}/pseudonyms/settings-overview`, {
      headers: admin,
      params: { examName: "2026년도 자격시험" },
    });
    expect(await overview.json()).toMatchObject([{ label: "전체" }]);

    for (const classificationMethod of [
      "UNIT",
      "MAJOR",
      "ROOM",
      "WAITING_ROOM",
      "DATE",
      "PERIOD",
      "GROUP",
      "ADMISSION",
    ]) {
      const updated = await request.put(`${api}/developer-settings`, {
        headers: developer,
        data: { ...profileInput, classificationMethod },
      });
      expect(updated.ok()).toBeTruthy();
      const [scopeResult, settingsResult] = await Promise.all([
        request.get(`${api}/accounts/classification-scopes`, { headers: admin }),
        request.get(`${api}/pseudonyms/settings-overview`, {
          headers: admin,
          params: { examName: "2026년도 자격시험" },
        }),
      ]);
      expect(scopeResult.ok()).toBeTruthy();
      expect(settingsResult.ok()).toBeTruthy();
      const available = (await scopeResult.json()).scopes as { key: string; label: string }[];
      expect(available.length).toBeGreaterThan(0);
      expect(await settingsResult.json()).toEqual(
        expect.arrayContaining(
          available.map(({ key, label }) => expect.objectContaining({ name: key, label, classificationMethod })),
        ),
      );
    }
    expect(await (await request.get(`${api}/examinees/operation/schedules`, { headers: operator })).json()).toEqual([]);
  } finally {
    await request.put(`${api}/developer-settings`, {
      headers: developer,
      data: { ...profileInput, classificationMethod: profile.classificationMethod ?? "ADMISSION" },
    });
    if (accountId) await request.delete(`${api}/accounts/${accountId}`, { headers: admin });
  }
});
