import { useCallback, useMemo, useState } from "react";
import { BrowserPrintAdapter } from "../printer/adapters/BrowserPrintAdapter";
import { MockPrinterAdapter } from "../printer/adapters/MockPrinterAdapter";
import { PrinterService } from "../printer/PrinterService";
import type { PrinterDiagnostic, PrinterMode } from "../printer/printer.types";

export const INITIAL_PRINTER_DIAGNOSTIC: PrinterDiagnostic = {
  status: "INITIALIZING",
  printer: null,
  message: "프린터 환경을 확인해 주세요.",
};

export interface PrinterRuntime {
  mode: PrinterMode;
  service: PrinterService;
  diagnostic: PrinterDiagnostic;
  busy: boolean;
  diagnose(): Promise<void>;
  resetDiagnostic(): void;
}

export function usePrinterRuntime(mode: PrinterMode = import.meta.env.VITE_PRINTER_MODE || "mock"): PrinterRuntime {
  const service = useMemo(
    () => new PrinterService(mode === "browser-print" ? new BrowserPrintAdapter() : new MockPrinterAdapter()),
    [mode],
  );
  const [diagnostic, setDiagnostic] = useState<PrinterDiagnostic>(INITIAL_PRINTER_DIAGNOSTIC);
  const [busy, setBusy] = useState(false);

  const diagnose = useCallback(async () => {
    setBusy(true);
    setDiagnostic({ ...INITIAL_PRINTER_DIAGNOSTIC, message: "설치 및 연결 상태를 확인하고 있습니다." });
    try {
      setDiagnostic(await service.diagnose());
    } finally {
      setBusy(false);
    }
  }, [service]);

  const resetDiagnostic = useCallback(() => {
    setDiagnostic(INITIAL_PRINTER_DIAGNOSTIC);
    setBusy(false);
  }, []);

  return { mode, service, diagnostic, busy, diagnose, resetDiagnostic };
}
