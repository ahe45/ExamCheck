import { describe, expect, it } from "vitest";
import { adminSectionPaths, getAdminSection } from "./admin-navigation";

describe("admin navigation", () => {
  it("관리자 메뉴 경로를 해당 메뉴로 복원한다", () => {
    expect(getAdminSection(adminSectionPaths.dashboard)).toBe("dashboard");
    expect(getAdminSection(adminSectionPaths.candidates)).toBe("candidates");
    expect(getAdminSection(adminSectionPaths.templates)).toBe("templates");
    expect(getAdminSection(adminSectionPaths.settings)).toBe("settings");
    expect(getAdminSection(adminSectionPaths.accounts)).toBe("accounts");
    expect(getAdminSection(adminSectionPaths.developer)).toBe("developer");
  });

  it("알 수 없는 관리자 경로는 메뉴로 복원하지 않는다", () => {
    expect(getAdminSection("/admin/unknown")).toBeNull();
  });
});
