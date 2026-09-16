import { SetMetadata } from "@nestjs/common";
import type { UserRole } from "./auth.types.js";

export const PERMISSIONS_KEY = "examcheck_permissions";

export type Permission =
  | "account.manage"
  | "candidate.import"
  | "candidate.read"
  | "developer.manage"
  | "driver.download"
  | "operation.close"
  | "operation.export"
  | "operation.reopen"
  | "print.create"
  | "pseudonym.assign"
  | "settings.manage"
  | "template.manage"
  | "workstation.manage";

const administratorPermissions = [
  "account.manage",
  "candidate.import",
  "candidate.read",
  "driver.download",
  "operation.close",
  "operation.export",
  "operation.reopen",
  "print.create",
  "pseudonym.assign",
  "settings.manage",
  "template.manage",
  "workstation.manage",
] as const satisfies readonly Permission[];

export const ROLE_PERMISSIONS = {
  ADMIN: administratorPermissions,
  OPERATOR: [
    "candidate.read",
    "driver.download",
    "operation.close",
    "operation.reopen",
    "operation.export",
    "print.create",
    "pseudonym.assign",
  ],
  VIEWER: ["candidate.read"],
  DEVELOPER: ["developer.manage", ...administratorPermissions],
} as const satisfies Readonly<Record<UserRole, readonly Permission[]>>;

export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

export function hasEveryPermission(role: UserRole, required: readonly Permission[]): boolean {
  const granted: readonly Permission[] = ROLE_PERMISSIONS[role];
  return required.every((permission) => granted.includes(permission));
}
