import { describe, expect, it } from "vitest";
import { DRIVER_FILES, isDriverId, resolveDriverPath } from "./driver-files.js";

describe("driver files", () => {
  it("allows only the two configured installers", () => {
    expect(isDriverId("windows")).toBe(true);
    expect(isDriverId("browser-print")).toBe(true);
    expect(isDriverId("../secret")).toBe(false);
  });

  it("resolves installers inside the project drivers directory", () => {
    expect(resolveDriverPath("windows")).toMatch(/[\\/]drivers[\\/]zd51177415-certified\.exe$/);
    expect(resolveDriverPath("browser-print")).toMatch(/[\\/]drivers[\\/]zebra-browser-print-windows-v132489\.exe$/);
    expect(DRIVER_FILES.windows.fileName).not.toContain("..");
  });
});
