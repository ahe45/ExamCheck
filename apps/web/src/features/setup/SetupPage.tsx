import { lazy, Suspense } from "react";
import type { AuthUser } from "../../shared/api/auth";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import type { AdminSection } from "../../shared/navigation/admin-navigation";
import type { BrowserNavigate } from "../../shared/navigation/use-browser-path";
import type { PrinterService } from "../printer/PrinterService";
import type { PrinterDiagnostic } from "../printer/printer.types";
import { AdminDashboard } from "./AdminDashboard";
import { AdminHeader } from "./AdminHeader";
import { UnsavedAdminChangesDialog } from "./UnsavedAdminChangesDialog";
import { useAdminDashboard } from "./useAdminDashboard";
import { useAdminSectionNavigation } from "./useAdminSectionNavigation";

const CandidateDataPage = lazy(() =>
  import("../candidates/CandidateDataPage").then((module) => ({ default: module.CandidateDataPage })),
);
const AccountManagementPage = lazy(() =>
  import("../accounts/AccountManagementPage").then((module) => ({ default: module.AccountManagementPage })),
);
const DeveloperSettingsPage = lazy(() =>
  import("../developer/DeveloperSettingsPage").then((module) => ({ default: module.DeveloperSettingsPage })),
);
const SystemSettingsOverviewPage = lazy(() =>
  import("./SystemSettingsOverviewPage").then((module) => ({ default: module.SystemSettingsOverviewPage })),
);
const FormTemplateManager = lazy(() =>
  import("../templates/FormTemplateManager").then((module) => ({ default: module.FormTemplateManager })),
);

interface Props {
  token: string;
  user: AuthUser;
  section: AdminSection;
  onNavigate: BrowserNavigate;
  systemProfile: DeveloperSettings;
  printerService?: PrinterService;
  printerDiagnostic?: PrinterDiagnostic;
  onSystemProfileChange(profile: DeveloperSettings): void;
  onLogout(): void;
}

export function SetupPage({
  token,
  user,
  section,
  onNavigate,
  systemProfile,
  printerService,
  printerDiagnostic,
  onSystemProfileChange,
  onLogout,
}: Props) {
  const dashboard = useAdminDashboard(token, section === "dashboard");
  const navigation = useAdminSectionNavigation({
    section,
    developerMode: user.role === "DEVELOPER",
    onNavigate,
    onLogout,
    onDashboardOpen: dashboard.refresh,
  });
  const { activeSection } = navigation;

  return (
    <div className={`exam-admin-app active-${activeSection}`}>
      <AdminHeader
        activeSection={activeSection}
        user={user}
        systemProfile={systemProfile}
        onOpenSection={navigation.openSection}
        onLogout={navigation.requestLogout}
      />

      <div className="exam-admin-workspace">
        <main
          className={`exam-admin-content ${activeSection === "templates" ? "template-admin-main" : ""} ${activeSection === "candidates" ? "candidate-admin-main" : ""} ${activeSection === "accounts" ? "account-admin-main" : ""} ${activeSection === "developer" ? "developer-admin-main" : ""}`}
        >
          {activeSection === "dashboard" && (
            <AdminDashboard
              statistics={dashboard.statistics}
              loading={dashboard.loading}
              error={dashboard.error}
              lastUpdated={dashboard.lastUpdated}
              onRefresh={() => void dashboard.refresh()}
              onOpenCandidates={() => navigation.openSection("candidates")}
            />
          )}

          <Suspense fallback={<AdminSectionLoading />}>
            {activeSection === "settings" && (
              <SystemSettingsOverviewPage
                ref={navigation.settingsPageRef}
                token={token}
                onDirtyChange={navigation.updateSettingsDirty}
              />
            )}

            {activeSection === "templates" && (
              <FormTemplateManager
                ref={navigation.templatePageRef}
                token={token}
                resetKey={navigation.templateResetKey}
                printerService={printerService}
                printerDiagnostic={printerDiagnostic}
                onDirtyChange={navigation.updateTemplateDirty}
              />
            )}

            {activeSection === "candidates" && <CandidateDataPage token={token} />}

            {activeSection === "accounts" && <AccountManagementPage token={token} currentUserId={user.id} />}

            {activeSection === "developer" && (
              <DeveloperSettingsPage token={token} user={user} onProfileChange={onSystemProfileChange} />
            )}
          </Suspense>
        </main>
      </div>

      <UnsavedAdminChangesDialog
        open={navigation.leaveConfirmation.open}
        saving={navigation.leaveConfirmation.saving}
        dirtyLabel={navigation.leaveConfirmation.dirtyLabel}
        onCancel={navigation.leaveConfirmation.cancel}
        onDiscard={navigation.leaveConfirmation.discard}
        onSave={() => void navigation.leaveConfirmation.save()}
      />
    </div>
  );
}

function AdminSectionLoading() {
  return (
    <div className="candidate-grid-empty" role="status">
      메뉴를 불러오는 중입니다.
    </div>
  );
}
