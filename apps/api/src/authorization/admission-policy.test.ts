import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser, UserRole } from "../auth/auth.types.js";
import {
  ADMISSION_SQL_COLUMNS,
  assertAdmissionAccess,
  buildAdmissionAccessPredicate,
  hasAdmissionAccess,
  normalizeAdmissionName,
  normalizedAssignedAdmissions,
  type AdmissionSqlColumn,
} from "./admission-policy.js";

function user(role: UserRole, admissionNames: string[] = []): AuthenticatedUser {
  return { id: 1, loginId: role.toLowerCase(), role, admissionNames };
}

describe("admission authorization matrix", () => {
  it.each(["ADMIN", "DEVELOPER"] satisfies UserRole[])("allows %s to access every admission", (role) => {
    expect(hasAdmissionAccess(user(role, ["배정 전형"]), "다른 전형")).toBe(true);
    expect(hasAdmissionAccess(user(role), "어떤 전형")).toBe(true);
    expect(hasAdmissionAccess(user(role), "  ")).toBe(false);
  });

  it.each(["OPERATOR", "VIEWER"] satisfies UserRole[])(
    "allows unrestricted %s accounts to access every admission",
    (role) => {
      expect(hasAdmissionAccess(user(role), "어떤 전형")).toBe(true);
      expect(hasAdmissionAccess(user(role, ["  "]), "어떤 전형")).toBe(true);
    },
  );

  it.each(["OPERATOR", "VIEWER"] satisfies UserRole[])(
    "limits assigned %s accounts to exact normalized names",
    (role) => {
      const restricted = user(role, ["  Ａ전형  ", "Ａ전형"]);
      expect(hasAdmissionAccess(restricted, "A전형")).toBe(true);
      expect(hasAdmissionAccess(restricted, "Ａ전형 ")).toBe(true);
      expect(hasAdmissionAccess(restricted, "a전형")).toBe(false);
      expect(hasAdmissionAccess(restricted, "다른 전형")).toBe(false);
    },
  );

  it("normalizes admission names with trim and NFKC without changing case", () => {
    expect(normalizeAdmissionName("  Ａdmission  ")).toBe("Admission");
    expect(normalizedAssignedAdmissions(user("OPERATOR", [" Ａ전형 ", "A전형", ""]))).toEqual(["A전형"]);
  });

  it("denies an unexpected runtime role instead of treating it as unrestricted", () => {
    const unexpectedRole = user("AUDITOR" as UserRole);
    expect(hasAdmissionAccess(unexpectedRole, "일반 전형")).toBe(false);
    expect(buildAdmissionAccessPredicate(unexpectedRole, ADMISSION_SQL_COLUMNS.candidateRecord)).toEqual({
      sql: "0 = 1",
      params: [],
    });
  });

  it("throws a friendly default or feature-specific forbidden message", () => {
    const restricted = user("OPERATOR", ["배정 전형"]);
    expect(() => assertAdmissionAccess(restricted, "다른 전형")).toThrow(ForbiddenException);
    expect(() => assertAdmissionAccess(restricted, "다른 전형")).toThrow("배정되지 않은 전형의 데이터");
    expect(() =>
      assertAdmissionAccess(restricted, "다른 전형", { forbiddenMessage: "이 전형은 출력할 수 없습니다." }),
    ).toThrow("이 전형은 출력할 수 없습니다.");
  });

  it("returns the normalized admission name after a successful assertion", () => {
    expect(assertAdmissionAccess(user("OPERATOR", ["Ａ전형"]), "  A전형  ")).toBe("A전형");
  });
});

describe("admission SQL predicates", () => {
  it("returns an unrestricted predicate for privileged and unassigned operator accounts", () => {
    expect(buildAdmissionAccessPredicate(user("ADMIN", ["일반"]), ADMISSION_SQL_COLUMNS.candidateRecord)).toEqual({
      sql: "1 = 1",
      params: [],
    });
    expect(buildAdmissionAccessPredicate(user("OPERATOR"), ADMISSION_SQL_COLUMNS.candidateRecord)).toEqual({
      sql: "1 = 1",
      params: [],
    });
  });

  it("uses placeholders and normalized values for assigned admission names", () => {
    expect(
      buildAdmissionAccessPredicate(user("VIEWER", [" 일반 ", " Ａ전형 "]), ADMISSION_SQL_COLUMNS.candidateRecord),
    ).toEqual({
      sql: "cr.admission IN (?, ?)",
      params: ["일반", "A전형"],
    });
  });

  it("rejects identifiers outside the constant allowlist at runtime", () => {
    expect(() =>
      buildAdmissionAccessPredicate(user("OPERATOR", ["일반"]), "cr.admission) OR 1 = 1 --" as AdmissionSqlColumn),
    ).toThrow("허용되지 않은 전형 컬럼");
  });
});
