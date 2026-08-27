import type { FormEvent } from "react";
import type { AuthUser } from "../../shared/api/auth";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import { ToastNotice } from "../../shared/components/ToastNotice";
import { DeveloperPasswordModal } from "./DeveloperPasswordModal";
import { DeveloperSettingsFormHeader, DeveloperSystemProfileSection } from "./DeveloperSystemProfileSection";
import { DeveloperUniquenessPolicySection } from "./DeveloperUniquenessPolicySection";
import { formatDeveloperSettingsUpdatedAt } from "./developer-settings-model";
import { useDeveloperSettingsController } from "./useDeveloperSettingsController";

interface Props {
  token: string;
  user: AuthUser;
  onProfileChange?(profile: DeveloperSettings): void;
}

export function DeveloperSettingsPage(props: Props) {
  if (props.user.role !== "DEVELOPER") return null;
  return <DeveloperSettingsContent {...props} />;
}

function DeveloperSettingsContent({ token, user, onProfileChange }: Props) {
  const controller = useDeveloperSettingsController({ token, onProfileChange });

  function submitSettings(event: FormEvent) {
    event.preventDefault();
    void controller.saveSettings();
  }

  if (controller.loading) {
    return (
      <section className="developer-settings-view">
        <div className="developer-settings-loading">개발자 설정을 불러오는 중입니다.</div>
      </section>
    );
  }

  return (
    <section className="developer-settings-view">
      {controller.notice && <ToastNotice notice={controller.notice} onClose={controller.dismissNotice} />}

      <div className="developer-settings-grid">
        <form
          id="developer-settings-form"
          className="developer-settings-card developer-profile-card"
          onSubmit={submitSettings}
        >
          <DeveloperSettingsFormHeader
            loading={controller.loading}
            saving={controller.saving}
            logoBusy={controller.logoBusy}
            dirty={controller.dirty}
            onOpenPassword={controller.openPasswordModal}
            onRefresh={() => void controller.refresh()}
          />
          <div className="developer-profile-layout">
            <DeveloperSystemProfileSection
              profile={controller.profile}
              form={controller.form}
              logoBusy={controller.logoBusy}
              onFormChange={controller.updateForm}
              onLogoSelected={(file) => void controller.selectLogo(file)}
              onRemoveLogo={() => void controller.removeLogo()}
            />
            <DeveloperUniquenessPolicySection
              form={controller.form}
              disabled={controller.saving || controller.logoBusy}
              onFormChange={controller.updateForm}
            />
          </div>
          <footer>
            <span>
              {controller.profile?.updatedAt
                ? `최근 저장 ${formatDeveloperSettingsUpdatedAt(controller.profile.updatedAt)}`
                : "저장 이력 없음"}
            </span>
          </footer>
        </form>
      </div>

      {controller.passwordModalOpen && (
        <DeveloperPasswordModal
          loginId={user.loginId}
          password={controller.password}
          saving={controller.passwordSaving}
          notice={controller.passwordNotice}
          onPasswordChange={controller.updatePassword}
          onClose={controller.closePasswordModal}
          onSave={() => void controller.savePassword()}
        />
      )}
    </section>
  );
}
