// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import {
  buildDeveloperSettingsInput,
  isDeveloperSettingsDirty,
  toDeveloperSettingsForm,
  validateDeveloperLogo,
  validateDeveloperPassword,
} from "./developer-settings-model";

const profile: DeveloperSettings = {
  schoolName: "한국대학교",
  academicYear: 2026,
  systemName: "가번호 관리 시스템",
  examineeNoUniqueness: "SYSTEM",
  pseudonymNoUniqueness: "ADMISSION",
  logoFileName: null,
  logoDataUrl: null,
  updatedAt: "2026-08-28T09:00:00.000Z",
};

describe("developer settings model", () => {
  it("화면 입력을 정규화한 값으로 dirty 상태와 저장 payload를 판정한다", () => {
    const form = { ...toDeveloperSettingsForm(profile), schoolName: "  한국대학교  " };
    expect(isDeveloperSettingsDirty(profile, form)).toBe(false);
    expect(buildDeveloperSettingsInput({ ...form, pseudonymNoUniqueness: "SCHEDULE" })).toEqual({
      schoolName: "한국대학교",
      academicYear: 2026,
      systemName: "가번호 관리 시스템",
      examineeNoUniqueness: "SYSTEM",
      pseudonymNoUniqueness: "SCHEDULE",
    });
  });

  it("로고 형식·크기와 비밀번호 입력 규칙을 순수하게 검증한다", () => {
    expect(validateDeveloperLogo(new File(["logo"], "logo.gif", { type: "image/gif" }))).toMatch(/PNG, JPG, WEBP/u);
    expect(
      validateDeveloperLogo(new File([new Uint8Array(2 * 1024 * 1024 + 1)], "logo.png", { type: "image/png" })),
    ).toMatch(/2MB/u);
    expect(validateDeveloperLogo(new File(["logo"], "logo.webp", { type: "image/webp" }))).toBeNull();
    expect(validateDeveloperPassword({ current: "1234", next: "123", confirm: "123" })).toMatch(/4자 이상/u);
    expect(validateDeveloperPassword({ current: "1234", next: "5678", confirm: "5679" })).toMatch(/일치/u);
    expect(validateDeveloperPassword({ current: "1234", next: "5678", confirm: "5678" })).toBeNull();
  });
});
