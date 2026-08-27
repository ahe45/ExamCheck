import type { AuthUser } from "../api/auth";
import type { OperationSchedule } from "../api/examinees";
import { adminSectionPaths, getAdminSection, type AdminSection } from "./admin-navigation";

export type AppRoute =
  { name: "login" } | { name: "admin"; section: AdminSection } | { name: "operation-select" } | { name: "operation" };

export interface AppRouteState {
  user: AuthUser | null;
  operationSchedule: OperationSchedule | null;
}

export interface ResolvedAppRoute {
  route: AppRoute;
  canonicalPath: string;
}

export function resolveAppRoute(pathname: string, state: AppRouteState): ResolvedAppRoute {
  if (!state.user) return { route: { name: "login" }, canonicalPath: "/" };

  if (state.user.role === "ADMIN" || state.user.role === "DEVELOPER") {
    const requestedSection = getAdminSection(pathname);
    const section =
      requestedSection && (state.user.role === "DEVELOPER" || requestedSection !== "developer")
        ? requestedSection
        : "dashboard";
    return {
      route: { name: "admin", section },
      canonicalPath: adminSectionPaths[section],
    };
  }

  if (state.operationSchedule) {
    return { route: { name: "operation" }, canonicalPath: "/operation" };
  }
  return { route: { name: "operation-select" }, canonicalPath: "/operation/select" };
}
