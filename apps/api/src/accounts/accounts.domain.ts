import type { UserRole } from "../auth/auth.types.js";

export type ManagedAccountRole = "ADMIN" | "USER";
export type StoredManagedAccountRole = "ADMIN" | "OPERATOR";

export interface AdmissionAssignmentResolution {
  admissionNames: string[];
  invalidAdmissionName: string | null;
}

export function normalizeLoginId(loginId: string): string {
  return loginId.trim();
}

export function toStoredAccountRole(role: ManagedAccountRole): StoredManagedAccountRole {
  return role === "ADMIN" ? "ADMIN" : "OPERATOR";
}

export function toManagedAccountRole(role: UserRole): ManagedAccountRole {
  return role === "ADMIN" ? "ADMIN" : "USER";
}

export function isGeneralAccountTarget(role: UserRole): boolean {
  return role !== "DEVELOPER";
}

export function isSelfRoleChangeForbidden(
  actorUserId: number,
  targetUserId: number,
  requestedRole: ManagedAccountRole,
): boolean {
  return actorUserId === targetUserId && requestedRole !== "ADMIN";
}

export function resolveAdmissionAssignments(
  role: ManagedAccountRole,
  requestedAdmissionNames: readonly string[],
  availableAdmissionNames: readonly string[],
): AdmissionAssignmentResolution {
  if (role === "ADMIN") return { admissionNames: [], invalidAdmissionName: null };

  const admissionNames = [...new Set(requestedAdmissionNames.map((value) => value.trim()).filter(Boolean))];
  const available = new Set(availableAdmissionNames);
  const invalidAdmissionName = admissionNames.find((value) => !available.has(value)) ?? null;
  return { admissionNames, invalidAdmissionName };
}
