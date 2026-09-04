import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AuthUser } from "../../shared/api/auth";
import { downloadDriver } from "../../shared/api/drivers";
import { fetchWorkstations } from "../../shared/api/workstations";
import { getWorkstationCode, saveWorkstationCode } from "../../shared/config/workstation";
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
import type { PrinterDevice, PrinterDiagnostic, PrinterMode } from "../printer/printer.types";
import { buildInstallationReport, type InstallationCheck } from "./installation-diagnostics";

interface Props {
  mode: PrinterMode;
  token: string;
  user: AuthUser;
  service: PrinterService;
  diagnostic: PrinterDiagnostic;
  printers: PrinterDevice[];
  selectedPrinterId: string | null;
  busy: boolean;
  onDiagnose(): Promise<void>;
  onSelectPrinter(printerId: string): void;
  onBack(): void;
  onLogout(): void;
}

export function PrinterSetupPage({
  mode,
  token,
  user,
  service,
  diagnostic,
  printers,
  selectedPrinterId,
  busy,
  onDiagnose,
  onSelectPrinter,
  onBack,
  onLogout,
}: Props) {
  const [printing, setPrinting] = useState(false);
  const [notice, setNotice] = useState<ToastNoticeValue | null>(null);
  const [draftPrinterId, setDraftPrinterId] = useState(selectedPrinterId ?? "");
  const [draftWorkstationCode, setDraftWorkstationCode] = useState(getWorkstationCode);
  const diagnosedOnOpen = useRef(false);
  const workstations = useQuery({
    queryKey: ["printer-workstations"],
    queryFn: () => fetchWorkstations(token),
    retry: false,
  });
  const report = buildInstallationReport(diagnostic, mode, busy);
  const enabledWorkstations = (workstations.data ?? []).filter((item) => item.enabled);
  const workstationRegistered = enabledWorkstations.some((item) => item.code === draftWorkstationCode);
  const printerAvailable = printers.some((item) => item.id === draftPrinterId);
  const canSaveSettings = printerAvailable && workstationRegistered && !busy;

  useEffect(() => {
    if (diagnosedOnOpen.current) return;
    diagnosedOnOpen.current = true;
    void onDiagnose();
  }, [onDiagnose]);

  useEffect(() => {
    if (selectedPrinterId) setDraftPrinterId(selectedPrinterId);
  }, [selectedPrinterId]);

  function saveSettings() {
    if (!canSaveSettings) return;
    onSelectPrinter(draftPrinterId);
    saveWorkstationCode(draftWorkstationCode);
    setNotice({ kind: "success", text: "이 PC의 출력 워크스테이션과 프린터 설정을 저장했습니다." });
  }

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
      <section className="card printer-device-settings">
        <header>
          <div>
            <p className="section-label">OUTPUT DEVICE</p>
            <h2>실제 출력 장치 설정</h2>
            <p>서버에 등록된 워크스테이션과 이 PC에 연결된 Zebra 프린터를 지정합니다.</p>
          </div>
          <span className={`printer-device-state ${report.ready && workstationRegistered ? "ready" : "pending"}`}>
            {report.ready && workstationRegistered ? "출력 가능" : "설정 필요"}
          </span>
        </header>
        <div className="printer-device-fields">
          <div className="printer-device-field">
            <label htmlFor="printer-workstation-select">출력 워크스테이션</label>
            <select
              id="printer-workstation-select"
              aria-describedby="printer-workstation-help"
              value={draftWorkstationCode}
              onChange={(event) => setDraftWorkstationCode(event.target.value)}
              disabled={workstations.isLoading}
            >
              {!workstationRegistered && draftWorkstationCode && (
                <option value={draftWorkstationCode}>{draftWorkstationCode} · 서버 미등록</option>
              )}
              {enabledWorkstations.map((workstation) => (
                <option value={workstation.code} key={workstation.id}>
                  {workstation.name} · {workstation.code}
                </option>
              ))}
            </select>
            <small id="printer-workstation-help">
              {workstations.isError
                ? "워크스테이션 목록을 불러오지 못했습니다."
                : workstationRegistered
                  ? "출력 작업이 이 워크스테이션으로 기록됩니다."
                  : "시스템 관리자에게 워크스테이션 등록을 요청해 주세요."}
            </small>
          </div>
          <div className="printer-device-field">
            <label htmlFor="printer-device-select">라벨 프린터</label>
            <select
              id="printer-device-select"
              aria-describedby="printer-device-help"
              value={draftPrinterId}
              onChange={(event) => setDraftPrinterId(event.target.value)}
              disabled={busy || printers.length === 0}
            >
              {printers.length === 0 && <option value="">검색된 프린터 없음</option>}
              {printers.length > 0 && !draftPrinterId && <option value="">프린터를 선택해 주세요</option>}
              {printers.map((printer) => (
                <option value={printer.id} key={printer.id}>
                  {printer.name} · {printerConnectionLabel(printer.connection)}
                </option>
              ))}
            </select>
            <small id="printer-device-help">{busy ? "연결된 프린터를 검색하고 있습니다." : diagnostic.message}</small>
          </div>
        </div>
        <footer>
          <button className="secondary" onClick={onDiagnose} disabled={busy}>
            <RefreshButtonIcon />
            <span>{busy ? "검색 중…" : "장치 다시 검색"}</span>
          </button>
          <button className="primary" onClick={saveSettings} disabled={!canSaveSettings}>
            설정 저장
          </button>
        </footer>
      </section>
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

function printerConnectionLabel(connection: PrinterDevice["connection"]) {
  if (connection === "USB") return "USB 연결";
  if (connection === "NETWORK") return "네트워크 연결";
  return "개발용 연결";
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
