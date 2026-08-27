// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AdminSection } from "../../shared/navigation/admin-navigation";
import { useAdminSectionNavigation } from "./useAdminSectionNavigation";

describe("useAdminSectionNavigation", () => {
  it("guards dirty settings and preserves cancel, discard, and save actions", async () => {
    const onNavigate = vi.fn();
    const onLogout = vi.fn();
    const onDashboardOpen = vi.fn();
    const { result, rerender } = renderHook(
      ({ section }: { section: AdminSection }) =>
        useAdminSectionNavigation({
          section,
          developerMode: false,
          onNavigate,
          onLogout,
          onDashboardOpen,
        }),
      { initialProps: { section: "settings" as AdminSection } },
    );

    act(() => result.current.updateSettingsDirty(true));
    act(() => result.current.openSection("candidates"));
    expect(result.current.leaveConfirmation).toMatchObject({ open: true, dirtyLabel: "시스템 설정" });
    expect(onNavigate).not.toHaveBeenCalled();

    act(() => result.current.leaveConfirmation.cancel());
    expect(result.current.leaveConfirmation.open).toBe(false);
    expect(result.current.activeSection).toBe("settings");

    const save = vi.fn().mockResolvedValue(true);
    result.current.settingsPageRef.current = { save };
    act(() => result.current.openSection("accounts"));
    await act(async () => {
      await result.current.leaveConfirmation.save();
    });
    expect(save).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveBeenCalledWith("/admin/accounts");
    rerender({ section: "accounts" });
    expect(result.current.activeSection).toBe("accounts");
    expect(result.current.leaveConfirmation.open).toBe(false);

    act(() => result.current.openSection("settings"));
    rerender({ section: "settings" });
    act(() => result.current.updateSettingsDirty(true));
    act(() => result.current.openSection("candidates"));
    expect(result.current.leaveConfirmation.open).toBe(true);
    act(() => result.current.leaveConfirmation.discard());
    expect(onNavigate).toHaveBeenLastCalledWith("/admin/candidates");
    expect(result.current.activeSection).toBe("candidates");
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("restores the current URL when an external route change hits a dirty section", () => {
    const onNavigate = vi.fn();
    const options = {
      developerMode: false,
      onNavigate,
      onLogout: vi.fn(),
      onDashboardOpen: vi.fn(),
    };
    const { result, rerender } = renderHook(
      ({ section }: { section: AdminSection }) => useAdminSectionNavigation({ section, ...options }),
      { initialProps: { section: "templates" as AdminSection } },
    );

    act(() => result.current.updateTemplateDirty(true));
    rerender({ section: "accounts" });

    expect(onNavigate).toHaveBeenCalledWith("/admin/templates", { replace: true });
    expect(result.current.activeSection).toBe("templates");
    expect(result.current.leaveConfirmation).toMatchObject({ open: true, dirtyLabel: "양식" });
  });

  it("keeps developer access top-level and increments the template reset key on re-entry", () => {
    const onNavigate = vi.fn();
    const onDashboardOpen = vi.fn();
    const { result } = renderHook(() =>
      useAdminSectionNavigation({
        section: "dashboard",
        developerMode: false,
        onNavigate,
        onLogout: vi.fn(),
        onDashboardOpen,
      }),
    );

    act(() => result.current.openSection("developer"));
    expect(onNavigate).toHaveBeenLastCalledWith("/admin");
    expect(result.current.activeSection).toBe("dashboard");
    expect(onDashboardOpen).toHaveBeenCalledOnce();

    act(() => result.current.openSection("templates"));
    expect(result.current.templateResetKey).toBe(1);
    act(() => result.current.openSection("accounts"));
    act(() => result.current.openSection("templates"));
    expect(result.current.templateResetKey).toBe(2);
  });

  it("guards logout and lets Escape cancel the top-level confirmation", () => {
    const onLogout = vi.fn();
    const { result } = renderHook(() =>
      useAdminSectionNavigation({
        section: "settings",
        developerMode: true,
        onNavigate: vi.fn(),
        onLogout,
        onDashboardOpen: vi.fn(),
      }),
    );

    act(() => result.current.updateSettingsDirty(true));
    act(() => result.current.requestLogout());
    expect(result.current.leaveConfirmation.open).toBe(true);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(result.current.leaveConfirmation.open).toBe(false);
    expect(onLogout).not.toHaveBeenCalled();
  });
});
