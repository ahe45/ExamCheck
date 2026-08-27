import { ForbiddenException } from "@nestjs/common";
import type { AuthenticatedUser, UserRole } from "../auth/auth.types.js";

const PRIVILEGED_ROLES = new Set<UserRole>(["ADMIN", "DEVELOPER"]);
const ASSIGNABLE_ROLES = new Set<UserRole>(["OPERATOR", "VIEWER"]);

export const ADMISSION_SQL_COLUMNS = Object.freeze({
  candidateRecord: "cr.admission",
  pseudonymAssignment: "pa.admission_name",
} as const);

export type AdmissionSqlColumn = (typeof ADMISSION_SQL_COLUMNS)[keyof typeof ADMISSION_SQL_COLUMNS];

const ALLOWED_ADMISSION_SQL_COLUMNS = new Set<string>(Object.values(ADMISSION_SQL_COLUMNS));
const DEFAULT_FORBIDDEN_MESSAGE = "배정되지 않은 전형의 데이터에는 접근할 수 없습니다.";

export interface AdmissionAccessPredicate {
  sql: "1 = 1" | "0 = 1" | `${AdmissionSqlColumn} IN (${string})`;
  params: string[];
}

export interface AdmissionAccessAssertionOptions {
  forbiddenMessage?: string;
}

export function normalizeAdmissionName(value: string): string {
  return value.normalize("NFKC").trim();
}

export function normalizedAssignedAdmissions(user: Pick<AuthenticatedUser, "admissionNames">): string[] {
  return [...new Set(user.admissionNames.map(normalizeAdmissionName).filter(Boolean))];
}

export function hasAdmissionAccess(
  user: Pick<AuthenticatedUser, "role" | "admissionNames">,
  admissionName: string,
): boolean {
  const normalizedAdmissionName = normalizeAdmissionName(admissionName);
  if (!normalizedAdmissionName) return false;
  if (PRIVILEGED_ROLES.has(user.role)) return true;
  if (!ASSIGNABLE_ROLES.has(user.role)) return false;

  const assignedAdmissions = normalizedAssignedAdmissions(user);
  if (assignedAdmissions.length === 0) return true;
  return assignedAdmissions.includes(normalizedAdmissionName);
}

export function assertAdmissionAccess(
  user: Pick<AuthenticatedUser, "role" | "admissionNames">,
  admissionName: string,
  options: AdmissionAccessAssertionOptions = {},
): string {
  if (!hasAdmissionAccess(user, admissionName)) {
    throw new ForbiddenException(options.forbiddenMessage ?? DEFAULT_FORBIDDEN_MESSAGE);
  }
  return normalizeAdmissionName(admissionName);
}

export function buildAdmissionAccessPredicate(
  user: Pick<AuthenticatedUser, "role" | "admissionNames">,
  column: AdmissionSqlColumn,
): AdmissionAccessPredicate {
  if (!ALLOWED_ADMISSION_SQL_COLUMNS.has(column)) {
    throw new TypeError("허용되지 않은 전형 컬럼입니다.");
  }
  if (PRIVILEGED_ROLES.has(user.role)) return { sql: "1 = 1", params: [] };
  if (!ASSIGNABLE_ROLES.has(user.role)) return { sql: "0 = 1", params: [] };

  const assignedAdmissions = normalizedAssignedAdmissions(user);
  if (assignedAdmissions.length === 0) return { sql: "1 = 1", params: [] };
  return {
    sql: `${column} IN (${assignedAdmissions.map(() => "?").join(", ")})`,
    params: assignedAdmissions,
  };
}
