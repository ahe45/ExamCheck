export type AdminSection = "dashboard" | "candidates" | "templates" | "settings" | "accounts" | "developer";

export const adminSectionPaths: Record<AdminSection, string> = {
  dashboard: "/admin",
  candidates: "/admin/candidates",
  templates: "/admin/templates",
  settings: "/admin/settings",
  accounts: "/admin/accounts",
  developer: "/admin/developer",
};

export function getAdminSection(pathname: string): AdminSection | null {
  const entry = Object.entries(adminSectionPaths).find(([, path]) => path === pathname);
  return entry ? (entry[0] as AdminSection) : null;
}
