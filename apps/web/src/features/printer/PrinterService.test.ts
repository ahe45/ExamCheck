import { describe, expect, it } from "vitest";
import { MockPrinterAdapter } from "./adapters/MockPrinterAdapter";
import { PrinterService, TEST_ZPL } from "./PrinterService";

describe("PrinterService", () => {
  it("diagnoses and sends one test payload without retrying", async () => {
    const adapter = new MockPrinterAdapter();
    const service = new PrinterService(adapter);
    const diagnostic = await service.diagnose();
    expect(diagnostic.status).toBe("READY");
    await service.testPrint(diagnostic.printer!);
    expect(adapter.lastPayload).toBe(TEST_ZPL);
  });
});
