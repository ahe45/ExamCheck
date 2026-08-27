import type { ReactNode } from "react";
import type { AuthUser } from "../../shared/api/auth";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import { AppLogoutIcon } from "../../shared/components/ActionIcons";
import type { AdminSection } from "../../shared/navigation/admin-navigation";

interface Props {
  activeSection: AdminSection;
  user: AuthUser;
  systemProfile: DeveloperSettings;
  onOpenSection(section: AdminSection): void;
  onLogout(): void;
}

export function AdminHeader({ activeSection, user, systemProfile, onOpenSection, onLogout }: Props) {
  const developerMode = user.role === "DEVELOPER";
  return (
    <header className="exam-admin-topbar">
      <button
        className="exam-admin-brand"
        type="button"
        onClick={() => onOpenSection("dashboard")}
        aria-label="대시보드로 이동"
      >
        <span className={`exam-admin-brand-mark ${systemProfile.logoDataUrl ? "has-image" : ""}`}>
          {systemProfile.logoDataUrl ? (
            <img src={systemProfile.logoDataUrl} alt={`${systemProfile.schoolName} 로고`} />
          ) : (
            "가"
          )}
        </span>
        <span>
          <small>
            {systemProfile.academicYear}학년도 · {systemProfile.schoolName || "EXAM NUMBER SYSTEM"}
          </small>
          <strong>{systemProfile.systemName}</strong>
        </span>
      </button>
      <nav className="exam-admin-topnav" aria-label={developerMode ? "개발자 메뉴" : "관리자 메뉴"}>
        <AdminMenuButton
          active={activeSection === "candidates"}
          icon={<CandidatesIcon />}
          label="수험생 데이터"
          onClick={() => onOpenSection("candidates")}
        />
        <AdminMenuButton
          active={activeSection === "templates"}
          icon={<TemplateIcon />}
          label="양식 관리"
          onClick={() => onOpenSection("templates")}
        />
        <AdminMenuButton
          active={activeSection === "settings"}
          icon={<NumberIcon />}
          label="시스템 설정"
          onClick={() => onOpenSection("settings")}
        />
        <AdminMenuButton
          active={activeSection === "accounts"}
          icon={<AccountsIcon />}
          label="계정 관리"
          onClick={() => onOpenSection("accounts")}
        />
        {developerMode && (
          <AdminMenuButton
            active={activeSection === "developer"}
            icon={<DeveloperIcon />}
            label="개발자"
            onClick={() => onOpenSection("developer")}
          />
        )}
      </nav>
      <div className="exam-admin-topbar-actions">
        <span className="exam-account-id" title={`로그인 ID: ${user.loginId}`}>
          {user.loginId}
        </span>
        <button className="exam-topbar-icon-button" onClick={onLogout}>
          <AppLogoutIcon />
          <span>로그아웃</span>
        </button>
      </div>
    </header>
  );
}

function AdminMenuButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      <span>{icon}</span>
      {label}
    </button>
  );
}

function NumberIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 3.5h8A2.5 2.5 0 0 1 16.5 6v8a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 14V6A2.5 2.5 0 0 1 6 3.5Z" />
      <path d="M7 7h6M7 10h6M7 13h3.5" />
    </svg>
  );
}

function TemplateIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 3.5h10A1.5 1.5 0 0 1 16.5 5v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 5 3.5Z" />
      <path d="M6.8 7h6.4M6.8 10h6.4M6.8 13h3.8" />
    </svg>
  );
}

function CandidatesIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8" cy="7" r="2.5" />
      <path d="M3.8 15.5c.3-3 1.8-4.5 4.2-4.5s3.9 1.5 4.2 4.5M13.3 6.2a2.2 2.2 0 0 1 0 4.2M14 11.8c1.5.5 2.3 1.7 2.5 3.7" />
    </svg>
  );
}

function AccountsIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="7.5" cy="7" r="2.4" />
      <path d="M3.5 15.4c.3-2.9 1.7-4.3 4-4.3s3.7 1.4 4 4.3M13.2 6.1a2.1 2.1 0 0 1 0 4M13.9 11.6c1.6.5 2.4 1.8 2.6 3.8" />
    </svg>
  );
}

function DeveloperIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m7.5 5-4 5 4 5M12.5 5l4 5-4 5M11 3.5 9 16.5" />
    </svg>
  );
}
