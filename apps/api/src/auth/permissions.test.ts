import { describe, expect, it } from "vitest";
import type { UserRole } from "./auth.types.js";
import { hasEveryPermission, ROLE_PERMISSIONS, type Permission } from "./permissions.js";

describe("role permission policy", () => {
  it("keeps developer as the only role that can manage developer settings", () => {
    expect(hasEveryPermission("DEVELOPER", ["developer.manage"])).toBe(true);
    expect(hasEveryPermission("ADMIN", ["developer.manage"])).toBe(false);
  });

  it("preserves the existing administrator and operator mutation boundaries", () => {
    expect(hasEveryPermission("ADMIN", ["settings.manage", "operation.reopen", "account.manage"])).toBe(true);
    expect(hasEveryPermission("OPERATOR", ["pseudonym.assign", "operation.close", "print.create"])).toBe(true);
    expect(hasEveryPermission("OPERATOR", ["settings.manage"])).toBe(false);
    expect(hasEveryPermission("OPERATOR", ["operation.reopen"])).toBe(true);
  });

  it("keeps viewer read-only", () => {
    expect(hasEveryPermission("VIEWER", ["candidate.read"])).toBe(true);
    expect(hasEveryPermission("VIEWER", ["pseudonym.assign"])).toBe(false);
    expect(hasEveryPermission("VIEWER", ["operation.reopen"])).toBe(false);
  });

  it("defines a duplicate-free permission set for every role", () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS) as Array<[UserRole, readonly Permission[]]>) {
      expect(new Set(permissions).size, role).toBe(permissions.length);
    }
  });
});
