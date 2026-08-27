import { describe, expect, it } from "vitest";
import { getActiveDirtySection, shouldGuardAdminNavigation } from "./admin-navigation-guard";

describe("admin dirty navigation guard", () => {
  it("현재 보고 있는 시스템 설정이 변경된 경우 다른 메뉴 이동을 보호한다", () => {
    const dirtyState = { templates: false, settings: true };

    expect(getActiveDirtySection("settings", dirtyState)).toBe("settings");
    expect(shouldGuardAdminNavigation("settings", "candidates", dirtyState)).toBe(true);
  });

  it("현재 보고 있는 양식 편집기가 변경된 경우 다른 메뉴 이동을 보호한다", () => {
    const dirtyState = { templates: true, settings: false };

    expect(getActiveDirtySection("templates", dirtyState)).toBe("templates");
    expect(shouldGuardAdminNavigation("templates", "dashboard", dirtyState)).toBe(true);
  });

  it("다른 메뉴의 상태나 현재 메뉴를 다시 선택하는 동작은 보호하지 않는다", () => {
    expect(shouldGuardAdminNavigation("candidates", "accounts", { templates: true, settings: true })).toBe(false);
    expect(shouldGuardAdminNavigation("templates", "templates", { templates: true, settings: false })).toBe(false);
  });
});
