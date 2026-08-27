import type { Account, AccountInput, AccountRole } from "../../shared/api/accounts";

export type AccountColumnKey = "loginId" | "role" | "access";

export interface AccountColumn {
  key: AccountColumnKey;
  label: string;
}

export interface AccountForm extends AccountInput {
  password: string;
  passwordConfirm: string;
}

export const accountColumns: AccountColumn[] = [
  { key: "loginId", label: "아이디" },
  { key: "role", label: "권한" },
  { key: "access", label: "배정 전형" },
];

export function emptyAccountForm(): AccountForm {
  return { loginId: "", role: "USER", password: "", passwordConfirm: "", admissionNames: [] };
}

export function accountFormFor(account: Account | null): AccountForm {
  if (!account) return emptyAccountForm();
  return {
    loginId: account.loginId,
    role: account.role,
    password: "",
    passwordConfirm: "",
    admissionNames: [...account.admissionNames],
  };
}

export function withAccountRole(form: AccountForm, role: AccountRole): AccountForm {
  return { ...form, role, admissionNames: role === "ADMIN" ? [] : form.admissionNames };
}

export function withToggledAdmission(form: AccountForm, admission: string): AccountForm {
  return {
    ...form,
    admissionNames: form.admissionNames.includes(admission)
      ? form.admissionNames.filter((value) => value !== admission)
      : [...form.admissionNames, admission],
  };
}

export function accountFormError(form: AccountForm, editing: boolean) {
  if (!editing && form.password.length < 4) return "새 계정의 비밀번호를 4자 이상 입력해 주세요.";
  if (form.password && form.password !== form.passwordConfirm) return "비밀번호 확인이 일치하지 않습니다.";
  return null;
}

export function accountInputFrom(form: AccountForm): AccountInput {
  return {
    loginId: form.loginId.trim(),
    role: form.role,
    admissionNames: form.role === "USER" ? [...form.admissionNames] : [],
    ...(form.password ? { password: form.password } : {}),
  };
}

export function accountColumnValue(account: Account, key: AccountColumnKey) {
  if (key === "role") return account.role === "ADMIN" ? "관리자" : "사용자";
  if (key === "access")
    return account.role === "ADMIN" || !account.admissionNames.length
      ? "전체 전형·교시"
      : account.admissionNames.join(", ");
  return account[key];
}
