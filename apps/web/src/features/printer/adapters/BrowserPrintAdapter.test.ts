// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserPrintDevice } from "../printer.types";

type AdapterModule = typeof import("./BrowserPrintAdapter");

let adapterModule: AdapterModule;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  Reflect.deleteProperty(window, "BrowserPrint");
  removeBrowserPrintScripts();
  adapterModule = await import("./BrowserPrintAdapter");
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "BrowserPrint");
  removeBrowserPrintScripts();
});

describe("BrowserPrintAdapter", () => {
  it("completes every SDK operation and ignores duplicate success/error callbacks", async () => {
    const rawDevice = device((_, onSuccess, onError) => {
      onSuccess();
      onSuccess();
      onError(new Error("duplicate send callback"));
    });
    const duplicateDevice = device();
    window.BrowserPrint = {
      getDefaultDevice(_type, onSuccess, onError) {
        onSuccess(rawDevice);
        onSuccess(duplicateDevice);
        onError(new Error("duplicate default callback"));
      },
      getLocalDevices(onSuccess, onError) {
        onSuccess([rawDevice]);
        onSuccess(null as never);
        onError(new Error("duplicate list callback"));
      },
    };
    const adapter = new adapterModule.BrowserPrintAdapter();

    await expect(adapter.initialize()).resolves.toBeUndefined();
    await expect(adapter.getDefaultPrinter()).resolves.toMatchObject({
      id: "GT800-USB",
      name: "ZDesigner GT800",
      connection: "USB",
    });
    await expect(adapter.listPrinters()).resolves.toEqual([
      expect.objectContaining({ id: "GT800-USB", connection: "USB", raw: rawDevice }),
    ]);
    await expect(
      adapter.send({ id: "GT800-USB", name: "GT800", connection: "USB", raw: rawDevice }, "^XA^XZ"),
    ).resolves.toBeUndefined();
    expect(rawDevice.send).toHaveBeenCalledWith("^XA^XZ", expect.any(Function), expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the installed Browser Print local service when no vendor script is bundled", async () => {
    const requests: Array<{ method: string; url: string; body?: string }> = [];
    class FakeXMLHttpRequest {
      readyState = 0;
      status = 0;
      responseText = "";
      onreadystatechange: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private method = "";
      private url = "";

      open(method: string, url: string) {
        this.method = method;
        this.url = url;
      }

      send(body?: string) {
        requests.push({ method: this.method, url: this.url, body });
        this.status = 200;
        this.readyState = 4;
        this.responseText = this.url.endsWith("/default?type=printer")
          ? "{}"
          : this.url.endsWith("/available")
            ? JSON.stringify({
                printer: [
                  {
                    uid: "GT800-USB",
                    name: "ZDesigner GT800",
                    connection: "usb",
                    deviceType: "printer",
                    version: 5,
                    provider: "zebra",
                    manufacturer: "Zebra Technologies",
                  },
                ],
              })
            : "";
        this.onreadystatechange?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const adapter = new adapterModule.BrowserPrintAdapter();

    await expect(adapter.initialize()).resolves.toBeUndefined();
    const printers = await adapter.listPrinters();
    expect(printers).toEqual([
      expect.objectContaining({ id: "GT800-USB", name: "ZDesigner GT800", connection: "USB" }),
    ]);
    await expect(adapter.send(printers[0]!, "^XA^XZ")).resolves.toBeUndefined();
    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: "GET", url: "http://127.0.0.1:9100/default?type=printer" },
      { method: "GET", url: "http://127.0.0.1:9100/available" },
      { method: "POST", url: "http://127.0.0.1:9100/write" },
    ]);
    expect(JSON.parse(requests[2]!.body!)).toMatchObject({
      device: { uid: "GT800-USB", connection: "usb" },
      data: "^XA^XZ",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a default-printer lookup and clears its timer", async () => {
    window.BrowserPrint = silentSdk();
    const pending = new adapterModule.BrowserPrintAdapter().getDefaultPrinter();
    const assertion = expect(pending).rejects.toThrow("BROWSER_PRINT_NOT_RUNNING");

    await vi.advanceTimersByTimeAsync(adapterModule.BROWSER_PRINT_TIMEOUTS.defaultPrinter);

    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a printer-list lookup and ignores callbacks that arrive afterward", async () => {
    let lateSuccess!: (devices: BrowserPrintDevice[]) => void;
    let lateError!: (error: unknown) => void;
    window.BrowserPrint = {
      getDefaultDevice() {},
      getLocalDevices(onSuccess, onError) {
        lateSuccess = onSuccess;
        lateError = onError;
      },
    };
    const resolved = vi.fn();
    const rejected = vi.fn();
    const pending = new adapterModule.BrowserPrintAdapter().listPrinters();
    void pending.then(resolved, rejected);

    await vi.advanceTimersByTimeAsync(adapterModule.BROWSER_PRINT_TIMEOUTS.listPrinters);

    expect(rejected).toHaveBeenCalledOnce();
    expect(rejected.mock.calls[0]?.[0]).toMatchObject({ message: "BROWSER_PRINT_NOT_RUNNING" });
    expect(resolved).not.toHaveBeenCalled();
    expect(() => lateSuccess(null as never)).not.toThrow();
    expect(() => lateError(new Error("late SDK error"))).not.toThrow();
    await Promise.resolve();
    expect(rejected).toHaveBeenCalledOnce();
    expect(resolved).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out printer transmission with an actionable user message", async () => {
    const rawDevice = device(() => undefined);
    const pending = new adapterModule.BrowserPrintAdapter().send(
      { id: "GT800-USB", name: "GT800", connection: "USB", raw: rawDevice },
      "^XA^XZ",
    );
    const assertion = expect(pending).rejects.toThrow(
      "프린터가 제한 시간 안에 응답하지 않았습니다. 실제 출력 여부를 확인한 뒤 다시 시도해 주세요.",
    );

    await vi.advanceTimersByTimeAsync(adapterModule.BROWSER_PRINT_TIMEOUTS.send);

    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("normalizes a printer SDK error callback to an actionable user message", async () => {
    const rawDevice = device((_, _onSuccess, onError) => onError(new Error("vendor-private-error")));

    await expect(
      new adapterModule.BrowserPrintAdapter().send(
        { id: "GT800-USB", name: "GT800", connection: "USB", raw: rawDevice },
        "^XA^XZ",
      ),
    ).rejects.toThrow("프린터로 데이터를 전송하지 못했습니다. 프린터 연결과 실제 출력 여부를 확인해 주세요.");
    expect(vi.getTimerCount()).toBe(0);
  });
});

function device(send?: BrowserPrintDevice["send"]): BrowserPrintDevice {
  return {
    uid: "GT800-USB",
    name: "ZDesigner GT800",
    connection: "usb",
    send: vi.fn(send ?? ((_data, onSuccess) => onSuccess())),
  };
}

function silentSdk(): NonNullable<Window["BrowserPrint"]> {
  return {
    getDefaultDevice() {},
    getLocalDevices() {},
  };
}

function browserPrintScripts() {
  return Array.from(document.head.querySelectorAll<HTMLScriptElement>("script")).filter((script) =>
    script.src.endsWith("/vendor/BrowserPrint.js"),
  );
}

function removeBrowserPrintScripts() {
  browserPrintScripts().forEach((script) => script.remove());
}
