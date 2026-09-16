import { ToastNotice } from "../../shared/components/ToastNotice";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { fetchHistoryResetPassword, updateHistoryResetPassword } from "../../shared/api/developer-settings";

export function HistoryResetPasswordSection({ token }: { token: string }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  useEffect(() => {
    let active = true;
    fetchHistoryResetPassword(token)
      .then((result) => {
        if (active) setConfigured(result.configured);
      })
      .catch((reason: unknown) => {
        if (active)
          setNotice({ error: true, text: reason instanceof Error ? reason.message : "설정을 불러오지 못했습니다." });
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    if (password !== confirmation) {
      setNotice({ error: true, text: "비밀번호 확인이 일치하지 않습니다." });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const result = await updateHistoryResetPassword(token, password);
      setConfigured(result.configured);
      setPassword("");
      setConfirmation("");
      setNotice({ error: false, text: "초기화 비밀번호를 저장했습니다." });
    } catch (reason) {
      setNotice({ error: true, text: reason instanceof Error ? reason.message : "비밀번호를 저장하지 못했습니다." });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <form className="developer-settings-card history-reset-password-card" onSubmit={(event) => void save(event)}>
      <h3>초기화 비밀번호 설정</h3>
      <p>사용자 화면의 이력 초기화와 시스템 설정의 전형별 초기화·삭제에 사용하는 비밀번호입니다.</p>
      <span className="history-reset-password-status">
        {configured === null ? "설정 상태 확인 중" : configured ? "비밀번호 설정됨" : "비밀번호 미설정"}
      </span>
      <div className="history-password-fields">
        <label>
          새 초기화 비밀번호
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={4}
            maxLength={200}
            value={password}
            disabled={saving}
            placeholder="4자 이상 입력"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          초기화 비밀번호 확인
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={4}
            maxLength={200}
            value={confirmation}
            disabled={saving}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        <button className="primary" type="submit" disabled={saving || password.length < 4 || !confirmation}>
          {saving ? "저장 중…" : "비밀번호 저장"}
        </button>
      </div>
      {notice && (
        <ToastNotice
          notice={{ kind: notice.error ? "error" : "success", text: notice.text }}
          onClose={() => setNotice(null)}
        />
      )}
    </form>
  );
}
