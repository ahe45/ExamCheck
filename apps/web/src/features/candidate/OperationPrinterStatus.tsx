import type { PrinterDiagnostic } from "../printer/printer.types";

interface Props {
  diagnostic: PrinterDiagnostic;
  busy: boolean;
  printing: boolean;
  onRecheck(): void;
}

export function OperationPrinterStatus({ diagnostic, busy, printing, onRecheck }: Props) {
  const ready = diagnostic.status === "READY" && Boolean(diagnostic.printer);
  const label = busy ? "확인 중…" : ready ? "연결됨" : "미연결";

  return (
    <div className="operator-printer-control" role="group" aria-label="라벨 프린터">
      <span>라벨 프린터</span>
      <button
        type="button"
        className={`operator-printer-status ${busy ? "checking" : ready ? "ready" : "error"}`}
        onClick={onRecheck}
        disabled={busy || printing}
        aria-label="연결 새로고침"
        aria-busy={busy}
        title="연결 새로고침"
      >
        <i aria-hidden="true" />
        <span role="status" aria-live="polite">
          {label}
        </span>
      </button>
    </div>
  );
}
