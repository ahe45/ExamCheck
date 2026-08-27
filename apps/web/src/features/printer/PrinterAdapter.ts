import type { PrinterDevice } from "./printer.types";

export interface PrinterAdapter {
  initialize(): Promise<void>;
  getDefaultPrinter(): Promise<PrinterDevice | null>;
  listPrinters(): Promise<PrinterDevice[]>;
  send(printer: PrinterDevice, rawData: string): Promise<void>;
  isAvailable(): Promise<boolean>;
}
