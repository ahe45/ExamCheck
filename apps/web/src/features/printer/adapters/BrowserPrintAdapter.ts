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
    await this.isAvailable();
  }

  async isAvailable() {
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
    return window.BrowserPrint ?? nativeBrowserPrintApi;
  }
}

const nativeBrowserPrintApi: BrowserPrintApi = {
  getDefaultDevice(_type, onSuccess, onError) {
    requestBrowserPrint(
      "GET",
      "default?type=printer",
      undefined,
      (response) => {
        const device = parseJson<BrowserPrintDevicePayload>(response);
        onSuccess(hasDeviceIdentity(device) ? createNativeDevice(device) : null);
      },
      onError,
    );
  },
  getLocalDevices(onSuccess, onError) {
    requestBrowserPrint(
      "GET",
      "available",
      undefined,
      (response) => {
        const available = parseJson<{ printer?: BrowserPrintDevicePayload[] }>(response);
        onSuccess((available.printer ?? []).filter(hasDeviceIdentity).map(createNativeDevice));
      },
      onError,
    );
  },
};

interface BrowserPrintDevicePayload {
  uid?: string;
  name?: string;
  connection?: string;
  deviceType?: string;
  version?: number;
  provider?: string;
  manufacturer?: string;
}

function createNativeDevice(payload: BrowserPrintDevicePayload): BrowserPrintDevice {
  return {
    ...payload,
    send(data, onSuccess, onError) {
      requestBrowserPrint("POST", "write", JSON.stringify({ device: payload, data }), () => onSuccess(), onError);
    },
  };
}

function requestBrowserPrint(
  method: "GET" | "POST",
  path: string,
  body: string | undefined,
  onSuccess: (response: string) => void,
  onError: (error: unknown) => void,
) {
  const request = new XMLHttpRequest();
  request.open(method, `${browserPrintBaseUrl()}${path}`, true);
  request.onreadystatechange = () => {
    if (request.readyState !== 4) return;
    if (request.status === 200) {
      try {
        onSuccess(request.responseText);
      } catch (error) {
        onError(error);
      }
      return;
    }
    onError(new Error("BROWSER_PRINT_NOT_RUNNING"));
  };
  request.onerror = () => onError(new Error("BROWSER_PRINT_NOT_RUNNING"));
  request.send(body);
}

function browserPrintBaseUrl() {
  const safari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  return safari && window.location.protocol === "https:" ? "https://127.0.0.1:9101/" : "http://127.0.0.1:9100/";
}

function parseJson<T>(value: string): T {
  return JSON.parse(value || "{}") as T;
}

function hasDeviceIdentity(device: BrowserPrintDevicePayload) {
  return Boolean(device.uid || device.name);
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
