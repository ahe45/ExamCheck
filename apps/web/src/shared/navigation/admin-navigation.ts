export const attendanceViews = [
  { key: "admission", label: "전형별" },
  { key: "unit", label: "모집단위별" },
  { key: "major", label: "전공별" },
  { key: "group", label: "조별" },
  { key: "date", label: "날짜별" },
  { key: "period", label: "교시별" },
  { key: "building", label: "건물별" },
  { key: "room", label: "고사실별" },
  { key: "waitingRoom", label: "대기실별" },
  { key: "candidate", label: "수험생별" },
] as const;
export type AttendanceView = (typeof attendanceViews)[number]["key"];
export type AttendanceSection = `attendance-${AttendanceView}`;
export type AdminSection =
  "dashboard" | "candidates" | "templates" | "settings" | "accounts" | "developer" | AttendanceSection;
export type TemplateKind = "document" | "label";

export const adminSectionPaths: Record<AdminSection, string> = {
  dashboard: "/admin",
  candidates: "/admin/candidates",
  templates: "/admin/templates",
  settings: "/admin/settings",
  accounts: "/admin/accounts",
  developer: "/admin/developer",
  "attendance-admission": "/admin/attendance/admission",
  "attendance-unit": "/admin/attendance/unit",
  "attendance-major": "/admin/attendance/major",
  "attendance-group": "/admin/attendance/group",
  "attendance-date": "/admin/attendance/date",
  "attendance-period": "/admin/attendance/period",
  "attendance-building": "/admin/attendance/building",
  "attendance-room": "/admin/attendance/room",
  "attendance-waitingRoom": "/admin/attendance/waitingRoom",
  "attendance-candidate": "/admin/attendance/candidate",
};

export function getAttendanceView(section: AdminSection): AttendanceView | null {
  return attendanceViews.find((view) => section === `attendance-${view.key}`)?.key ?? null;
}

export function getAdminSection(pathname: string): AdminSection | null {
  const entry = Object.entries(adminSectionPaths).find(([, path]) => path === pathname);
  return entry ? (entry[0] as AdminSection) : null;
}
