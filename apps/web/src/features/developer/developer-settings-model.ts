import type { DeveloperSettings, DeveloperSettingsInput } from "../../shared/api/developer-settings";

export interface DeveloperPasswordForm {
  current: string;
  next: string;
  confirm: string;
}

export interface DeveloperSettingsNotice {
  kind: "success" | "error";
  text: string;
}

export const EMPTY_DEVELOPER_SETTINGS_FORM: DeveloperSettingsInput = {
  schoolName: "",
  academicYear: new Date().getFullYear(),
  systemName: "가번호 관리 시스템",
  examineeNoUniqueness: "SYSTEM",
  pseudonymNoUniqueness: "ADMISSION",
};

export const EMPTY_DEVELOPER_PASSWORD_FORM: DeveloperPasswordForm = {
  current: "",
  next: "",
  confirm: "",
};

export function toDeveloperSettingsForm(profile: DeveloperSettings): DeveloperSettingsInput {
  return {
    schoolName: profile.schoolName,
    academicYear: profile.academicYear,
    systemName: profile.systemName,
    examineeNoUniqueness: profile.examineeNoUniqueness,
    pseudonymNoUniqueness: profile.pseudonymNoUniqueness,
  };
}

export function buildDeveloperSettingsInput(form: DeveloperSettingsInput): DeveloperSettingsInput {
  return {
    schoolName: form.schoolName.trim(),
    academicYear: Number(form.academicYear),
    systemName: form.systemName.trim(),
    examineeNoUniqueness: form.examineeNoUniqueness,
    pseudonymNoUniqueness: form.pseudonymNoUniqueness,
  };
}

export function isDeveloperSettingsDirty(profile: DeveloperSettings | null, form: DeveloperSettingsInput): boolean {
  if (!profile) return false;
  const input = buildDeveloperSettingsInput(form);
  return (
    input.schoolName !== profile.schoolName ||
    input.academicYear !== profile.academicYear ||
    input.systemName !== profile.systemName ||
    input.examineeNoUniqueness !== profile.examineeNoUniqueness ||
    input.pseudonymNoUniqueness !== profile.pseudonymNoUniqueness
  );
}

export function validateDeveloperLogo(file: File): string | null {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    return "로고는 PNG, JPG, WEBP 이미지 파일만 사용할 수 있습니다.";
  }
  if (file.size > 2 * 1024 * 1024) return "로고 파일은 2MB 이하여야 합니다.";
  return null;
}

export function validateDeveloperPassword(form: DeveloperPasswordForm): string | null {
  if (form.next.length < 4) return "새 비밀번호를 4자 이상 입력해 주세요.";
  if (form.next !== form.confirm) return "새 비밀번호 확인이 일치하지 않습니다.";
  return null;
}

export function formatDeveloperSettingsUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
