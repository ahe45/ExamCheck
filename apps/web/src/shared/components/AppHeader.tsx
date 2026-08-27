import type { AuthUser } from "../api/auth";
import { AppLogoutIcon } from "./ActionIcons";

export function AppHeader({
  user,
  title,
  subtitle,
  onLogout,
}: {
  user: AuthUser;
  title: string;
  subtitle: string;
  onLogout(): void;
}) {
  return (
    <header className="hero app-header">
      <div>
        <p className="eyebrow">가번호 관리 시스템</p>
        <h1>{title}</h1>
        <p className="subtitle">{subtitle}</p>
      </div>
      <div className="account-panel">
        <div className="account-copy">
          <strong title={`로그인 ID: ${user.loginId}`}>{user.loginId}</strong>
        </div>
        <button className="link-button" onClick={onLogout}>
          <AppLogoutIcon />
          <span>로그아웃</span>
        </button>
      </div>
    </header>
  );
}
