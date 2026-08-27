import type { PrinterAdapter } from "../PrinterAdapter";
import type { BrowserPrintDevice, PrinterDevice } from "../printer.types";

interface BrowserPrintApi {
  getDefaultDevice(
    type: "printer",
    onSuccess: (device: BrowserPrintDevice | null) => void,
    onError: (error: unknown) => void,
  ): void;
  getLocalDevices(
    onSuccess: (devices: BrowserPrintDevice[]) => void,
    onError: (error: unknown) => void,
    type: "printer",
  ): void;
}

declare global {
  interface Window {
    BrowserPrint?: BrowserPrintApi;
  }
}

export const BROWSER_PRINT_TIMEOUTS = Object.freeze({
  scriptLoad: 10_000,
  defaultPrinter: 5_000,
  listPrinters: 5_000,
  send: 15_000,
});

const browserPrintNotRunningError = () => new Error("BROWSER_PRINT_NOT_RUNNING");
const printerSendFailedError = () =>
  new Error("프린터로 데이터를 전송하지 못했습니다. 프린터 연결과 실제 출력 여부를 확인해 주세요.");
const printerSendTimeoutError = () =>
  new Error("프린터가 제한 시간 안에 응답하지 않았습니다. 실제 출력 여부를 확인한 뒤 다시 시도해 주세요.");

export class BrowserPrintAdapter implements PrinterAdapter {
  async initialize() {
    await loadBrowserPrintScript();
    if (!window.BrowserPrint) throw new Error("BROWSER_PRINT_SDK_MISSING");
    await this.isAvailable();
  }

  async isAvailable() {
    if (!window.BrowserPrint) return false;
    try {
      await this.getDefaultPrinter();
      return true;
    } catch {
      throw new Error("BROWSER_PRINT_NOT_RUNNING");
    }
  }

  async getDefaultPrinter(): Promise<PrinterDevice | null> {
    const api = this.requireApi();
    const device = await waitForBrowserPrintCallback<BrowserPrintDevice | null>(
      (onSuccess, onError) => api.getDefaultDevice("printer", onSuccess, onError),
      BROWSER_PRINT_TIMEOUTS.defaultPrinter,
      browserPrintNotRunningError,
      browserPrintNotRunningError,
    );
    return device ? mapDevice(device) : null;
  }

  async listPrinters(): Promise<PrinterDevice[]> {
    const api = this.requireApi();
    const devices = await waitForBrowserPrintCallback<BrowserPrintDevice[]>(
      (onSuccess, onError) => api.getLocalDevices(onSuccess, onError, "printer"),
      BROWSER_PRINT_TIMEOUTS.listPrinters,
      browserPrintNotRunningError,
      browserPrintNotRunningError,
    );
    return devices.map(mapDevice);
  }

  async send(printer: PrinterDevice, rawData: string): Promise<void> {
    if (!printer.raw) throw new Error("PRINTER_NOT_FOUND");
    await waitForBrowserPrintCallback<void>(
      (onSuccess, onError) => printer.raw!.send(rawData, onSuccess, onError),
      BROWSER_PRINT_TIMEOUTS.send,
      printerSendFailedError,
      printerSendTimeoutError,
    );
  }

  private requireApi() {
    if (!window.BrowserPrint) throw new Error("BROWSER_PRINT_SDK_MISSING");
    return window.BrowserPrint;
  }
}

let browserPrintScript: Promise<void> | null = null;

function loadBrowserPrintScript(): Promise<void> {
  if (window.BrowserPrint) return Promise.resolve();
  if (browserPrintScript) return browserPrintScript;

  const script = document.createElement("script");
  script.src = "/vendor/BrowserPrint.js";
  let resolveScript!: () => void;
  let rejectScript!: (error: Error) => void;
  let settled = false;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const pendingScript = new Promise<void>((resolve, reject) => {
    resolveScript = resolve;
    rejectScript = reject;
  });
  browserPrintScript = pendingScript;

  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
    script.onload = null;
    script.onerror = null;
    if (!error) {
      resolveScript();
      return;
    }
    if (browserPrintScript === pendingScript) browserPrintScript = null;
    script.remove();
    rejectScript(error);
  };

  timeoutId = globalThis.setTimeout(
    () => finish(new Error("BROWSER_PRINT_SDK_MISSING")),
    BROWSER_PRINT_TIMEOUTS.scriptLoad,
  );
  script.onload = () => finish(window.BrowserPrint ? undefined : new Error("BROWSER_PRINT_SDK_MISSING"));
  script.onerror = () => finish(new Error("BROWSER_PRINT_SDK_MISSING"));
  try {
    document.head.appendChild(script);
  } catch {
    finish(new Error("BROWSER_PRINT_SDK_MISSING"));
  }
  return pendingScript;
}

function waitForBrowserPrintCallback<T>(
  start: (onSuccess: (value: T) => void, onError: (error: unknown) => void) => void,
  timeoutMs: number,
  callbackError: () => Error,
  timeoutError: () => Error,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
      complete();
    };

    timeoutId = globalThis.setTimeout(() => finish(() => reject(timeoutError())), timeoutMs);
    try {
      start(
        (value) => finish(() => resolve(value)),
        () => finish(() => reject(callbackError())),
      );
    } catch {
      finish(() => reject(callbackError()));
    }
  });
}

function mapDevice(device: BrowserPrintDevice): PrinterDevice {
  const name = device.name || "Zebra Printer";
  return {
    id: device.uid || name,
    name,
    connection: device.connection?.toLowerCase().includes("usb") ? "USB" : "NETWORK",
    raw: device,
  };
}
