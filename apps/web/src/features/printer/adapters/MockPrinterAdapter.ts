import type { PrinterAdapter } from "../PrinterAdapter";
import type { PrinterDevice } from "../printer.types";

export class MockPrinterAdapter implements PrinterAdapter {
  readonly printer: PrinterDevice = { id: "MOCK-GT800-001", name: "Mock Zebra GT800", connection: "MOCK" };
  lastPayload: string | null = null;

  async initialize() {}
  async isAvailable() {
    return true;
  }
  async getDefaultPrinter() {
    return this.printer;
  }
  async listPrinters() {
    return [this.printer];
  }

  async send(_printer: PrinterDevice, rawData: string) {
    this.lastPayload = rawData;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
  }
}
