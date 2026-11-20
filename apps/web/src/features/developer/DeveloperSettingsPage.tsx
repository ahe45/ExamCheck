import { DatabaseBackupSection } from "./DatabaseBackupSection";
import type { FormEvent } from "react";
import type { AuthUser } from "../../shared/api/auth";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import { classificationLabels, type ClassificationMethod } from "../../shared/classification";
import { SettingsButtonIcon } from "../../shared/components/ActionIcons";
import { ToastNotice } from "../../shared/components/ToastNotice";
import { DeveloperPasswordModal } from "./DeveloperPasswordModal";
import { ExamDataMaintenanceSection } from "./ExamDataMaintenanceSection";
import { HistoryResetPasswordSection } from "./HistoryResetPasswordSection";
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
            <section className="developer-classification-section" aria-labelledby="developer-classification-title">
              <header>
                <span className="developer-section-icon">
                  <SettingsButtonIcon />
                </span>
                <div>
                  <h4 id="developer-classification-title">분류 방법</h4>
                  <p id="developer-classification-help">
                    시스템 설정과 사용자 접근 권한에 적용합니다. 기존에 접근 범위가 제한된 계정은 새 기준에서 권한을
                    확인해 주세요.
                  </p>
                </div>
              </header>
              <select
                aria-labelledby="developer-classification-title"
                aria-describedby="developer-classification-help"
                value={controller.form.classificationMethod ?? "ADMISSION"}
                onChange={(event) =>
                  controller.updateForm({ classificationMethod: event.target.value as ClassificationMethod })
                }
                disabled={controller.saving || controller.logoBusy}
              >
                {Object.entries(classificationLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </section>
          </div>
          <footer>
            <span>
              {controller.profile?.updatedAt
                ? `최근 저장 ${formatDeveloperSettingsUpdatedAt(controller.profile.updatedAt)}`
                : "저장 이력 없음"}
            </span>
          </footer>
        </form>
        <HistoryResetPasswordSection token={token} />
        <DatabaseBackupSection token={token} />
        <ExamDataMaintenanceSection token={token} />
      </div>

      {controller.passwordModalOpen && (
        <DeveloperPasswordModal
          loginId={user.loginId}
          password={controller.password}
          saving={controller.passwordSaving}
          notice={controller.passwordNotice}
          onCloseNotice={controller.dismissPasswordNotice}
          onPasswordChange={controller.updatePassword}
          onClose={controller.closePasswordModal}
          onSave={() => void controller.savePassword()}
        />
      )}
    </section>
  );
}
