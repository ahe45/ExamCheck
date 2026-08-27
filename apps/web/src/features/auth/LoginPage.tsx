import { useState, type FormEvent } from "react";
import type { Session } from "../../shared/api/auth";
import { login } from "../../shared/api/auth";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import { LoginButtonIcon } from "../../shared/components/ActionIcons";

export function LoginPage({
  systemProfile,
  onLogin,
}: {
  systemProfile: DeveloperSettings;
  onLogin(session: Session): void;
}) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onLogin(await login(loginId.trim(), password));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "로그인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-shell">
        <div className="login-brand">
          <div className={`brand-mark ${systemProfile.logoDataUrl ? "has-image" : ""}`}>
            {systemProfile.logoDataUrl ? (
              <img src={systemProfile.logoDataUrl} alt={`${systemProfile.schoolName} 로고`} />
            ) : (
              "가"
            )}
          </div>
          <p className="eyebrow">
            {systemProfile.academicYear}학년도 · {systemProfile.schoolName || "EXAM NUMBER MANAGEMENT"}
          </p>
          <h1>{systemProfile.systemName}</h1>
          <p>수험번호를 인식하여 가번호를 부여하고 관리합니다.</p>
        </div>
        <form className="card login-card" onSubmit={submit}>
          <p className="section-label">SIGN IN</p>
          <h2>계정 로그인</h2>
          <label>
            아이디
            <input
              autoFocus
              autoComplete="username"
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              placeholder="아이디 입력"
            />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="비밀번호 입력"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary login-submit" disabled={busy || !loginId.trim() || password.length < 4}>
            <LoginButtonIcon />
            <span>{busy ? "로그인 중…" : "로그인"}</span>
          </button>
        </form>
      </section>
    </main>
  );
}
