import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "./auth.types.js";
import { PERMISSIONS_KEY } from "./permissions.js";
import { RolesGuard } from "./roles.js";

describe("RolesGuard", () => {
  it("keeps developer as the top-level role for protected business features", () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => (key === PERMISSIONS_KEY ? undefined : ["ADMIN"])),
    } as unknown as Reflector;
    const developer: AuthenticatedUser = {
      id: 3,
      loginId: "dev",
      role: "DEVELOPER",
      admissionNames: [],
    };
    const context = {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => ({ user: developer }) }),
    } as unknown as ExecutionContext;

    expect(new RolesGuard(reflector).canActivate(context)).toBe(true);
  });

  it("authorizes a permission through the centralized role policy", () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => (key === PERMISSIONS_KEY ? ["operation.close"] : undefined)),
    } as unknown as Reflector;
    const operator: AuthenticatedUser = {
      id: 2,
      loginId: "operator",
      role: "OPERATOR",
      admissionNames: [],
    };

    expect(new RolesGuard(reflector).canActivate(contextFor(operator))).toBe(true);
  });

  it("rejects a role without the required permission", () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => (key === PERMISSIONS_KEY ? ["operation.reopen"] : undefined)),
    } as unknown as Reflector;
    const operator: AuthenticatedUser = {
      id: 2,
      loginId: "operator",
      role: "OPERATOR",
      admissionNames: [],
    };

    expect(() => new RolesGuard(reflector).canActivate(contextFor(operator))).toThrow(
      "이 기능을 사용할 권한이 없습니다.",
    );
  });
});

function contextFor(user: AuthenticatedUser): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}
