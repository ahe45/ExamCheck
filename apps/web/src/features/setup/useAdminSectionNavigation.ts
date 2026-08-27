import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveDirtySection, shouldGuardAdminNavigation } from "../../shared/navigation/admin-navigation-guard";
import { adminSectionPaths, type AdminSection } from "../../shared/navigation/admin-navigation";
import type { BrowserNavigate } from "../../shared/navigation/use-browser-path";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import type { FormTemplateManagerHandle } from "../templates/FormTemplateManager";
import type { SystemSettingsPageHandle } from "./SystemSettingsPage";

type DirtySection = "templates" | "settings";
type LeaveAction = AdminSection | "logout";

interface Options {
  section: AdminSection;
  developerMode: boolean;
  onNavigate: BrowserNavigate;
  onLogout(): void;
  onDashboardOpen(): void;
}

export function useAdminSectionNavigation({ section, developerMode, onNavigate, onLogout, onDashboardOpen }: Options) {
  const [activeSection, setActiveSection] = useState<AdminSection>(section);
  const activeSectionRef = useRef(activeSection);
  const settingsPageRef = useRef<SystemSettingsPageHandle>(null);
  const templatePageRef = useRef<FormTemplateManagerHandle>(null);
  const settingsDirtyRef = useRef(false);
  const templateDirtyRef = useRef(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [templateDirty, setTemplateDirty] = useState(false);
  const [pendingLeaveAction, setPendingLeaveAction] = useState<LeaveAction | null>(null);
  const [pendingDirtySection, setPendingDirtySection] = useState<DirtySection | null>(null);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [leaveSaving, setLeaveSaving] = useState(false);
  const [templateResetKey, setTemplateResetKey] = useState(0);

  const updateSettingsDirty = useCallback((dirty: boolean) => {
    settingsDirtyRef.current = dirty;
    setSettingsDirty(dirty);
  }, []);

  const updateTemplateDirty = useCallback((dirty: boolean) => {
    templateDirtyRef.current = dirty;
    setTemplateDirty(dirty);
  }, []);

  useEffect(() => {
    activeSectionRef.current = activeSection;
  }, [activeSection]);

  useEffect(() => {
    if (!getActiveDirtySection(activeSection, { settings: settingsDirty, templates: templateDirty })) return;
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [activeSection, settingsDirty, templateDirty]);

  const navigateToSection = useCallback(
    (targetSection: AdminSection) => {
      if (!developerMode && targetSection === "developer") targetSection = "dashboard";
      const previousSection = activeSectionRef.current;
      onNavigate(adminSectionPaths[targetSection]);
      setActiveSection(targetSection);
      activeSectionRef.current = targetSection;
      if (targetSection === "templates" && previousSection !== "templates") {
        setTemplateResetKey((value) => value + 1);
      }
      if (targetSection === "dashboard") onDashboardOpen();
    },
    [developerMode, onDashboardOpen, onNavigate],
  );

  useEffect(() => {
    if (section === activeSectionRef.current) return;
    const currentSection = activeSectionRef.current;
    const dirtyState = { settings: settingsDirtyRef.current, templates: templateDirtyRef.current };
    if (shouldGuardAdminNavigation(currentSection, section, dirtyState)) {
      onNavigate(adminSectionPaths[currentSection], { replace: true });
      setPendingLeaveAction(section);
      setPendingDirtySection(getActiveDirtySection(currentSection, dirtyState));
      setLeaveConfirmOpen(true);
      return;
    }
    setActiveSection(section);
    activeSectionRef.current = section;
    if (section === "templates" && currentSection !== "templates") setTemplateResetKey((value) => value + 1);
    if (section === "dashboard") onDashboardOpen();
  }, [onDashboardOpen, onNavigate, section]);

  const cancelPendingLeave = useCallback(() => {
    setLeaveConfirmOpen(false);
    setPendingLeaveAction(null);
    setPendingDirtySection(null);
  }, []);

  useEscapeKey(leaveConfirmOpen && !leaveSaving, cancelPendingLeave);

  const openSection = useCallback(
    (targetSection: AdminSection) => {
      const currentSection = activeSectionRef.current;
      const dirtyState = { settings: settingsDirtyRef.current, templates: templateDirtyRef.current };
      if (shouldGuardAdminNavigation(currentSection, targetSection, dirtyState)) {
        setPendingLeaveAction(targetSection);
        setPendingDirtySection(getActiveDirtySection(currentSection, dirtyState));
        setLeaveConfirmOpen(true);
        return;
      }
      navigateToSection(targetSection);
    },
    [navigateToSection],
  );

  const requestLogout = useCallback(() => {
    const dirtySection = getActiveDirtySection(activeSectionRef.current, {
      settings: settingsDirtyRef.current,
      templates: templateDirtyRef.current,
    });
    if (dirtySection) {
      setPendingLeaveAction("logout");
      setPendingDirtySection(dirtySection);
      setLeaveConfirmOpen(true);
      return;
    }
    onLogout();
  }, [onLogout]);

  const completePendingLeave = useCallback(() => {
    const action = pendingLeaveAction;
    setLeaveConfirmOpen(false);
    setPendingLeaveAction(null);
    setPendingDirtySection(null);
    setSettingsDirty(false);
    setTemplateDirty(false);
    settingsDirtyRef.current = false;
    templateDirtyRef.current = false;
    if (action === "logout") onLogout();
    else if (action) navigateToSection(action);
  }, [navigateToSection, onLogout, pendingLeaveAction]);

  const saveBeforeLeaving = useCallback(async () => {
    if (leaveSaving) return;
    setLeaveSaving(true);
    let saved: boolean;
    try {
      const dirtySection =
        pendingDirtySection ??
        getActiveDirtySection(activeSectionRef.current, {
          settings: settingsDirtyRef.current,
          templates: templateDirtyRef.current,
        });
      saved =
        dirtySection === "templates"
          ? ((await templatePageRef.current?.save()) ?? false)
          : dirtySection === "settings"
            ? ((await settingsPageRef.current?.save()) ?? false)
            : true;
    } catch {
      saved = false;
    } finally {
      setLeaveSaving(false);
    }
    if (saved) completePendingLeave();
    else cancelPendingLeave();
  }, [cancelPendingLeave, completePendingLeave, leaveSaving, pendingDirtySection]);

  return {
    activeSection,
    settingsPageRef,
    templatePageRef,
    templateResetKey,
    updateSettingsDirty,
    updateTemplateDirty,
    openSection,
    requestLogout,
    leaveConfirmation: {
      open: leaveConfirmOpen,
      saving: leaveSaving,
      dirtyLabel: pendingDirtySection === "templates" ? "양식" : "시스템 설정",
      cancel: cancelPendingLeave,
      discard: completePendingLeave,
      save: saveBeforeLeaving,
    },
  };
}
