import { describe, expect, it } from "vitest";
import type { Account } from "../../shared/api/accounts";
import {
  accountColumnValue,
  accountFormError,
  accountFormFor,
  accountInputFrom,
  emptyAccountForm,
  withAccountRole,
  withToggledAdmission,
} from "./account-management-model";

const account: Account = {
  id: 7,
  loginId: "operator",
  role: "USER",
  admissionNames: ["학생부교과 면접"],
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: null,
};

describe("account management model", () => {
  it("신규 및 수정 폼을 계정 API 모델과 분리해 생성한다", () => {
    expect(emptyAccountForm()).toEqual({
      loginId: "",
      role: "USER",
      password: "",
      passwordConfirm: "",
      admissionNames: [],
    });

    const form = accountFormFor(account);
    form.admissionNames.push("추가 전형");
    expect(form).toMatchObject({ loginId: "operator", role: "USER", password: "", passwordConfirm: "" });
    expect(account.admissionNames).toEqual(["학생부교과 면접"]);
  });

  it("관리자 전환 시 전형 배정을 제거하고 사용자 전형 선택을 토글한다", () => {
    const form = accountFormFor(account);
    expect(withAccountRole(form, "ADMIN").admissionNames).toEqual([]);
    expect(withToggledAdmission(form, "학생부교과 면접").admissionNames).toEqual([]);
    expect(withToggledAdmission(form, "실기 전형").admissionNames).toEqual(["학생부교과 면접", "실기 전형"]);
  });

  it("신규 비밀번호와 확인값을 검증한다", () => {
    expect(accountFormError({ ...emptyAccountForm(), password: "123" }, false)).toBe(
      "새 계정의 비밀번호를 4자 이상 입력해 주세요.",
    );
    expect(accountFormError({ ...emptyAccountForm(), password: "1234", passwordConfirm: "5678" }, false)).toBe(
      "비밀번호 확인이 일치하지 않습니다.",
    );
    expect(accountFormError({ ...emptyAccountForm(), password: "1234", passwordConfirm: "1234" }, false)).toBeNull();
    expect(accountFormError(accountFormFor(account), true)).toBeNull();
  });

  it("API 입력값을 정규화하고 관리자 전형 배정을 제외한다", () => {
    expect(
      accountInputFrom({
        loginId: "  admin2  ",
        role: "ADMIN",
        password: "1234",
        passwordConfirm: "1234",
        admissionNames: ["학생부교과 면접"],
      }),
    ).toEqual({ loginId: "admin2", role: "ADMIN", password: "1234", admissionNames: [] });
  });

  it("그리드의 권한과 전형 접근 범위를 사용자 문구로 변환한다", () => {
    expect(accountColumnValue(account, "role")).toBe("사용자");
    expect(accountColumnValue(account, "access")).toBe("학생부교과 면접");
    expect(accountColumnValue({ ...account, admissionNames: [] }, "access")).toBe("전체 전형·교시");
    expect(accountColumnValue({ ...account, role: "ADMIN" }, "role")).toBe("관리자");
  });
});
