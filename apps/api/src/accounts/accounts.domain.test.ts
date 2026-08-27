import { describe, expect, it } from "vitest";
import {
  isGeneralAccountTarget,
  isSelfRoleChangeForbidden,
  resolveAdmissionAssignments,
  toManagedAccountRole,
  toStoredAccountRole,
} from "./accounts.domain.js";

describe("account domain policy", () => {
  it("maps public and stored roles without leaking storage details", () => {
    expect(toStoredAccountRole("ADMIN")).toBe("ADMIN");
    expect(toStoredAccountRole("USER")).toBe("OPERATOR");
    expect(toManagedAccountRole("VIEWER")).toBe("USER");
  });

  it("protects developer accounts and an administrator's own role", () => {
    expect(isGeneralAccountTarget("DEVELOPER")).toBe(false);
    expect(isGeneralAccountTarget("ADMIN")).toBe(true);
    expect(isSelfRoleChangeForbidden(1, 1, "USER")).toBe(true);
    expect(isSelfRoleChangeForbidden(1, 1, "ADMIN")).toBe(false);
    expect(isSelfRoleChangeForbidden(1, 2, "USER")).toBe(false);
  });

  it("normalizes user assignments and reports the first unknown admission", () => {
    expect(resolveAdmissionAssignments("USER", [" 전형 A ", "전형 A", "", "전형 C"], ["전형 A", "전형 B"])).toEqual({
      admissionNames: ["전형 A", "전형 C"],
      invalidAdmissionName: "전형 C",
    });
  });

  it("keeps no assignments for administrators, meaning unrestricted access", () => {
    expect(resolveAdmissionAssignments("ADMIN", ["없는 전형"], [])).toEqual({
      admissionNames: [],
      invalidAdmissionName: null,
    });
  });
});
