// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../shared/api/auth";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import { AdminHeader } from "./AdminHeader";
import { attendanceViews } from "../../shared/navigation/admin-navigation";

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
  it("places attendance before candidates and opens all ten choices on hover", () => {
    const onOpenSection = vi.fn();
    render(
      <AdminHeader
        activeSection="attendance-room"
        user={user("ADMIN")}
        systemProfile={profile}
        onOpenSection={onOpenSection}
        onLogout={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "응시 현황" });
    const candidates = screen.getByRole("button", { name: "수험생 데이터" });
    expect(trigger.compareDocumentPosition(candidates) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.mouseEnter(trigger.parentElement!);
    for (const view of attendanceViews) expect(screen.getByRole("button", { name: view.label })).toBeVisible();
    expect(screen.getByRole("button", { name: "고사실별" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "수험생별" }));
    expect(onOpenSection).toHaveBeenCalledWith("attendance-candidate");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens template choices on hover and sends the selected kind directly", () => {
    const onOpenSection = vi.fn();
    render(
      <AdminHeader
        activeSection="templates"
        templateKind="label"
        user={user("ADMIN")}
        systemProfile={profile}
        onOpenSection={onOpenSection}
        onLogout={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "양식 관리" });
    expect(screen.queryByRole("button", { name: "라벨 양식" })).not.toBeInTheDocument();
    fireEvent.mouseEnter(trigger.parentElement!);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "라벨 양식" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "문서 양식" }));
    expect(onOpenSection).toHaveBeenCalledWith("templates", "document");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "라벨 양식" }));
    expect(onOpenSection).toHaveBeenLastCalledWith("templates", "label");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

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
