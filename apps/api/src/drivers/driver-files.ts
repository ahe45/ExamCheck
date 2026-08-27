import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DRIVER_FILES = {
  windows: {
    fileName: "zd51177415-certified.exe",
    displayName: "ZDesigner Windows Printer Driver v5",
  },
  "browser-print": {
    fileName: "zebra-browser-print-windows-v132489.exe",
    displayName: "Zebra Browser Print for Windows",
  },
} as const;

export type DriverId = keyof typeof DRIVER_FILES;

export function isDriverId(value: string): value is DriverId {
  return value in DRIVER_FILES;
}

export function resolveDriverPath(driverId: DriverId): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(moduleDirectory, "../../../../");
  return resolve(projectRoot, "drivers", DRIVER_FILES[driverId].fileName);
}
