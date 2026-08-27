import { useState } from "react";
import type { AuthUser } from "../../shared/api/auth";
import { downloadDriver } from "../../shared/api/drivers";
import { AppHeader } from "../../shared/components/AppHeader";
import { ToastNotice, type ToastNoticeValue } from "../../shared/components/ToastNotice";
import {
  BackButtonIcon,
  DownloadButtonIcon,
  RefreshButtonIcon,
  TestButtonIcon,
} from "../../shared/components/ActionIcons";
import { GT800_WINDOWS_DRIVER } from "../printer/driver-download";
import type { PrinterService } from "../printer/PrinterService";
import type { PrinterDiagnostic, PrinterMode } from "../printer/printer.types";
import { buildInstallationReport, type InstallationCheck } from "./installation-diagnostics";

interface Props {
  mode: PrinterMode;
  token: string;
  user: AuthUser;
  service: PrinterService;
  diagnostic: PrinterDiagnostic;
  busy: boolean;
  onDiagnose(): Promise<void>;
  onBack(): void;
  onLogout(): void;
}

export function PrinterSetupPage({
  mode,
  token,
  user,
  service,
  diagnostic,
  busy,
  onDiagnose,
  onBack,
  onLogout,
}: Props) {
  const [printing, setPrinting] = useState(false);
  const [notice, setNotice] = useState<ToastNoticeValue | null>(null);
  const report = buildInstallationReport(diagnostic, mode, busy);

  async function testPrint() {
    if (!diagnostic.printer || printing) return;
    setPrinting(true);
    setNotice(null);
    try {
      await service.testPrint(diagnostic.printer);
      setNotice({ kind: "success", text: "테스트 데이터를 프린터로 전송했습니다. 실제 라벨 출력을 확인해 주세요." });
    } catch {
      setNotice({ kind: "error", text: "테스트 데이터를 전송하지 못했습니다. 프린터 연결을 확인해 주세요." });
    } finally {
      setPrinting(false);
    }
  }

  return (
    <main className="operator-printer-page">
      <AppHeader
        user={user}
        title="프린터 설정"
        subtitle="라벨 출력에 필요한 프로그램 설치와 프린터 연결 상태를 확인합니다."
        onLogout={onLogout}
      />
      <div className="operator-printer-toolbar">
        <button className="secondary" onClick={onBack}>
          <BackButtonIcon />
          <span>가번호 부여 화면으로</span>
        </button>
        <button className="primary" onClick={onDiagnose} disabled={busy}>
          <RefreshButtonIcon />
          <span>{busy ? "확인 중…" : "프린터 환경 확인"}</span>
        </button>
      </div>
      {mode === "mock" && (
        <div className="mode-banner">
          <strong>Mock Printer 모드</strong>
          <span>현재 화면은 개발용 시뮬레이션이며 이 PC의 실제 설치 상태를 검사하지 않습니다.</span>
        </div>
      )}
      <section className="setup-layout">
        <div className="setup-list">
          {report.checks.map((item) => (
            <InstallationCard key={item.id} item={item} token={token} />
          ))}
        </div>
        <aside className="card setup-summary">
          <p className="section-label">READINESS</p>
          <h2>{report.ready ? "출력 준비 완료" : "설치 상태 확인"}</h2>
          <div className={`readiness-mark ${report.ready ? "complete" : "incomplete"}`} aria-hidden="true">
            {report.ready ? "✓" : "!"}
          </div>
          <p>{report.summary}</p>
          <div className="setup-actions">
            <button className="secondary" onClick={onDiagnose} disabled={busy}>
              <RefreshButtonIcon />
              <span>{busy ? "확인 중…" : "설치 상태 다시 확인"}</span>
            </button>
            <button className="primary" onClick={testPrint} disabled={!report.ready || printing}>
              <TestButtonIcon />
              <span>{printing ? "전송 중…" : "테스트 라벨 출력"}</span>
            </button>
          </div>
          {notice && <ToastNotice notice={notice} onClose={() => setNotice(null)} />}
        </aside>
      </section>
    </main>
  );
}

function InstallationCard({ item, token }: { item: InstallationCheck; token: string }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download =
    item.id === "WINDOWS_DRIVER"
      ? { id: "windows" as const, label: "Windows 드라이버 다운로드" }
      : item.id === "BROWSER_PRINT"
        ? { id: "browser-print" as const, label: "Browser Print 다운로드" }
        : null;

  async function startDownload() {
    if (!download || downloading) return;
    setDownloading(true);
    setError(null);
    try {
      await downloadDriver(token, download.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "설치 파일을 다운로드하지 못했습니다.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <article className={`card installation-card status-${item.status.toLowerCase()}`}>
      <div className="install-step">{item.step}</div>
      <div className="install-content">
        <div className="install-heading">
          <h2>{item.title}</h2>
          <span className="check-status">{item.statusLabel}</span>
        </div>
        <p>{item.description}</p>
        {item.id === "WINDOWS_DRIVER" && (
          <small>
            {GT800_WINDOWS_DRIVER.name} · {GT800_WINDOWS_DRIVER.version}
          </small>
        )}
        {item.id === "BROWSER_PRINT" && <small>Windows용 로컬 출력 브리지 프로그램</small>}
        {download && (
          <button className="install-link" onClick={startDownload} disabled={downloading}>
            <DownloadButtonIcon />
            <span>{downloading ? "다운로드 준비 중…" : download.label}</span>
          </button>
        )}
        {error && <small className="download-error">{error}</small>}
      </div>
    </article>
  );
}
