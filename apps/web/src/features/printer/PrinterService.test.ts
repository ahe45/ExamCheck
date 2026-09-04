import { describe, expect, it } from "vitest";
import type { PrinterAdapter } from "./PrinterAdapter";
import { MockPrinterAdapter } from "./adapters/MockPrinterAdapter";
import { PrinterService, TEST_ZPL } from "./PrinterService";
import type { PrinterDevice } from "./printer.types";

describe("PrinterService", () => {
  it("diagnoses and sends one test payload without retrying", async () => {
    const adapter = new MockPrinterAdapter();
    const service = new PrinterService(adapter);
    const diagnostic = await service.diagnose();
    expect(diagnostic.status).toBe("READY");
    await service.testPrint(diagnostic.printer!);
    expect(adapter.lastPayload).toBe(TEST_ZPL);
  });

  it("uses a saved device when Browser Print finds multiple printers", async () => {
    const printers: PrinterDevice[] = [
      { id: "GT800-1", name: "접수처 프린터", connection: "USB" },
      { id: "GT800-2", name: "운영실 프린터", connection: "NETWORK" },
    ];
    const adapter: PrinterAdapter = {
      initialize: async () => undefined,
      isAvailable: async () => true,
      getDefaultPrinter: async () => null,
      listPrinters: async () => printers,
      send: async () => undefined,
    };

    const discovery = await new PrinterService(adapter).discover("GT800-2");

    expect(discovery.printers).toEqual(printers);
    expect(discovery.diagnostic).toMatchObject({ status: "READY", printer: { id: "GT800-2" } });
  });
});
