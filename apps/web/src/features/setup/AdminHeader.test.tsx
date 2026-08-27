// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../shared/api/auth";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import { AdminHeader } from "./AdminHeader";

const profile: DeveloperSettings = {
  schoolName: "한국대학교",
  academicYear: 2026,
  systemName: "가번호 관리 시스템",
  examineeNoUniqueness: "SYSTEM",
  pseudonymNoUniqueness: "ADMISSION",
  logoFileName: null,
  logoDataUrl: null,
  updatedAt: "2026-08-28T00:00:00.000Z",
};

describe("AdminHeader", () => {
  it("keeps the administrator menu, brand navigation, account id, and logout action", () => {
    const onOpenSection = vi.fn();
    const onLogout = vi.fn();
    render(
      <AdminHeader
        activeSection="settings"
        user={user("ADMIN")}
        systemProfile={profile}
        onOpenSection={onOpenSection}
        onLogout={onLogout}
      />,
    );

    expect(screen.getByRole("navigation", { name: "관리자 메뉴" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "개발자" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "시스템 설정" })).toHaveClass("active");
    expect(screen.getByTitle("로그인 ID: admin")).toHaveTextContent("admin");
    fireEvent.click(screen.getByRole("button", { name: "대시보드로 이동" }));
    expect(onOpenSection).toHaveBeenCalledWith("dashboard");
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("shows every menu only to the top-level developer role", () => {
    render(
      <AdminHeader
        activeSection="developer"
        user={user("DEVELOPER")}
        systemProfile={{ ...profile, logoDataUrl: "data:image/png;base64,AA==" }}
        onOpenSection={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    expect(screen.getByRole("navigation", { name: "개발자 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "개발자" })).toHaveClass("active");
    expect(screen.getByAltText("한국대학교 로고")).toHaveAttribute("src", "data:image/png;base64,AA==");
  });
});

function user(role: AuthUser["role"]): AuthUser {
  return { id: 1, loginId: role === "DEVELOPER" ? "dev" : "admin", role, admissionNames: [] };
}
