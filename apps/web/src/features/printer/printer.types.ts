export type PrinterStatus =
  | "INITIALIZING"
  | "READY"
  | "BROWSER_PRINT_SDK_MISSING"
  | "BROWSER_PRINT_NOT_RUNNING"
  | "PRINTER_NOT_FOUND"
  | "MULTIPLE_PRINTERS"
  | "PRINTER_OFFLINE"
  | "PRINTING"
  | "ERROR";

export type PrinterMode = "mock" | "browser-print";

export interface PrinterDevice {
  id: string;
  name: string;
  connection: "USB" | "NETWORK" | "MOCK";
  raw?: BrowserPrintDevice;
}

export interface PrinterDiagnostic {
  status: PrinterStatus;
  printer: PrinterDevice | null;
  message: string;
}

export interface BrowserPrintDevice {
  uid?: string;
  name?: string;
  connection?: string;
  send(data: string, onSuccess: () => void, onError: (error: unknown) => void): void;
}
