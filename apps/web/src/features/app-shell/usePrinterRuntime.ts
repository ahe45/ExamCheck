import { useCallback, useMemo, useState } from "react";
import { BrowserPrintAdapter } from "../printer/adapters/BrowserPrintAdapter";
import { MockPrinterAdapter } from "../printer/adapters/MockPrinterAdapter";
import { PrinterService } from "../printer/PrinterService";
import type { PrinterDevice, PrinterDiagnostic, PrinterMode } from "../printer/printer.types";

export const INITIAL_PRINTER_DIAGNOSTIC: PrinterDiagnostic = {
  status: "INITIALIZING",
  printer: null,
  message: "프린터 환경을 확인해 주세요.",
};

export interface PrinterRuntime {
  mode: PrinterMode;
  service: PrinterService;
  diagnostic: PrinterDiagnostic;
  printers: PrinterDevice[];
  selectedPrinterId: string | null;
  busy: boolean;
  diagnose(): Promise<void>;
  selectPrinter(printerId: string): void;
  resetDiagnostic(): void;
}

export function usePrinterRuntime(
  mode: PrinterMode = import.meta.env.VITE_PRINTER_MODE || "browser-print",
): PrinterRuntime {
  const service = useMemo(
    () => new PrinterService(mode === "browser-print" ? new BrowserPrintAdapter() : new MockPrinterAdapter()),
    [mode],
  );
  const [diagnostic, setDiagnostic] = useState<PrinterDiagnostic>(INITIAL_PRINTER_DIAGNOSTIC);
  const [printers, setPrinters] = useState<PrinterDevice[]>([]);
  const [selectedPrinterId, setSelectedPrinterId] = useState<string | null>(() => readPreferredPrinterId());
  const [busy, setBusy] = useState(false);

  const diagnose = useCallback(async () => {
    setBusy(true);
    setDiagnostic({ ...INITIAL_PRINTER_DIAGNOSTIC, message: "설치 및 연결 상태를 확인하고 있습니다." });
    try {
      const discovery = await service.discover(selectedPrinterId);
      setPrinters(discovery.printers);
      setDiagnostic(discovery.diagnostic);
      if (discovery.diagnostic.printer) {
        setSelectedPrinterId(discovery.diagnostic.printer.id);
        savePreferredPrinterId(discovery.diagnostic.printer.id);
      }
    } finally {
      setBusy(false);
    }
  }, [selectedPrinterId, service]);

  const selectPrinter = useCallback(
    (printerId: string) => {
      const printer = printers.find((item) => item.id === printerId);
      if (!printer) return;
      setSelectedPrinterId(printer.id);
      savePreferredPrinterId(printer.id);
      setDiagnostic({ status: "READY", printer, message: `${printer.name} 프린터를 사용할 수 있습니다.` });
    },
    [printers],
  );

  const resetDiagnostic = useCallback(() => {
    setDiagnostic(INITIAL_PRINTER_DIAGNOSTIC);
    setPrinters([]);
    setBusy(false);
  }, []);

  return { mode, service, diagnostic, printers, selectedPrinterId, busy, diagnose, selectPrinter, resetDiagnostic };
}

const PRINTER_PREFERENCE_KEY = "examcheck.printer.device-id";

function readPreferredPrinterId() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PRINTER_PREFERENCE_KEY);
  } catch {
    return null;
  }
}

function savePreferredPrinterId(printerId: string) {
  try {
    window.localStorage.setItem(PRINTER_PREFERENCE_KEY, printerId);
  } catch {
    // 브라우저 저장소가 차단되어도 현재 세션의 프린터 선택은 유지합니다.
  }
}
