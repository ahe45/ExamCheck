import { useRef, useState } from "react";
import { apiBlob, apiFetch, saveBlob } from "../../shared/api/client";
import { ToastNotice } from "../../shared/components/ToastNotice";

export function DatabaseBackupSection({ token }: { token: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<"backup" | "restore" | null>(null);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [restored, setRestored] = useState(false);

  async function run(action: "backup" | "restore") {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action);
    setNotice(null);
    try {
      if (action === "backup") {
        const { blob } = await apiBlob("/developer-settings/backup", { timeoutMs: 600_000 }, token);
        saveBlob(blob, `examcheck-backup-${new Date().toISOString().replaceAll(":", "-")}.json.gz`);
        setNotice({ kind: "success", text: "백업 파일을 다운로드했습니다." });
      } else {
        if (!file) throw new Error("백업 파일을 선택해 주세요.");
        if (file.size > 100 * 1024 * 1024) throw new Error("100MB 이하의 백업 파일을 선택해 주세요.");
        const body = new FormData();
        body.append("file", file);
        body.append("password", password);
        body.append("confirmation", confirmation);
        await apiFetch("/developer-settings/restore", { method: "POST", body, timeoutMs: 600_000 }, token);
        setPassword("");
        setConfirmation("");
        setRestored(true);
        setNotice({ kind: "success", text: "복원했습니다. 백업 시점의 계정 정보로 다시 로그인해 주세요." });
      }
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "작업을 완료하지 못했습니다." });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  return (
    <section className="developer-settings-card history-reset-password-card database-backup-card">
      <h3>백업 및 복원</h3>
      <p>
        계정, 수험생과 사진, 양식, 설정, 운영 이력을 백업 파일로 저장합니다. 서버 접속 설정과 임시 작업 파일은 포함되지
        않습니다.
      </p>
      <p>백업에는 개인정보와 계정 인증 정보가 포함됩니다. 안전한 곳에 보관해 주세요.</p>
      <button
        type="button"
        className="exam-outline-button"
        disabled={Boolean(busy) || restored}
        onClick={() => void run("backup")}
      >
        {busy === "backup" ? "백업 중…" : "백업 다운로드"}
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run("restore");
        }}
      >
        <h4>백업 파일 복원</h4>
        <p>
          현재 데이터 전체가 백업 시점의 데이터로 교체됩니다. 먼저 현재 데이터를 백업하고, 다른 사용자의 작업을 중단한
          뒤 진행해 주세요. 복원 후에는 모든 계정이 다시 로그인해야 합니다.
        </p>
        <div className="history-password-fields">
          <label>
            백업 파일 (.json.gz, 최대 100MB)
            <input
              aria-label="복원할 백업 파일"
              type="file"
              accept=".gz"
              required
              disabled={Boolean(busy) || restored}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            현재 개발자 비밀번호
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              disabled={Boolean(busy) || restored}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            확인 문구 ‘복원’ 입력
            <input
              required
              value={confirmation}
              disabled={Boolean(busy) || restored}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <button
            className="exam-danger-button"
            type="submit"
            disabled={Boolean(busy) || restored || !file || !password || confirmation !== "복원"}
          >
            {busy === "restore" ? "복원 중…" : "데이터 복원"}
          </button>
        </div>
      </form>
      {notice && <ToastNotice notice={notice} onClose={() => setNotice(null)} />}
      {restored && (
        <button type="button" className="exam-primary-button" onClick={() => window.location.reload()}>
          다시 로그인
        </button>
      )}
    </section>
  );
}
