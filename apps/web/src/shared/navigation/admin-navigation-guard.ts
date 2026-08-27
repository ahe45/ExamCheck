import type { AdminSection } from "./admin-navigation";

export type GuardedAdminSection = Extract<AdminSection, "templates" | "settings">;

export interface AdminDirtyState {
  templates: boolean;
  settings: boolean;
}

export function getActiveDirtySection(
  activeSection: AdminSection,
  dirtyState: AdminDirtyState,
): GuardedAdminSection | null {
  if (activeSection === "templates" && dirtyState.templates) return "templates";
  if (activeSection === "settings" && dirtyState.settings) return "settings";
  return null;
}

export function shouldGuardAdminNavigation(
  activeSection: AdminSection,
  nextSection: AdminSection,
  dirtyState: AdminDirtyState,
) {
  return activeSection !== nextSection && getActiveDirtySection(activeSection, dirtyState) !== null;
}
