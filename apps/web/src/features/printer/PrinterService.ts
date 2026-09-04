import type { PrinterAdapter } from "./PrinterAdapter";
import type { PrinterDiagnostic, PrinterDiscovery } from "./printer.types";

export const TEST_ZPL =
  "^XA^PW600^LL300^FO40,30^A0N,35,35^FDPRINTER TEST^FS^FO40,90^A0N,25,25^FDZEBRA GT800^FS^FO40,140^BCN,80,Y,N,N^FD1234567890^FS^XZ";

export class PrinterService {
  constructor(private readonly adapter: PrinterAdapter) {}

  async discover(preferredPrinterId?: string | null): Promise<PrinterDiscovery> {
    try {
      await this.adapter.initialize();
      const printers = await this.adapter.listPrinters();
      if (printers.length === 0)
        return {
          printers,
          diagnostic: {
            status: "PRINTER_NOT_FOUND",
            printer: null,
            message: "연결된 Zebra 프린터를 찾을 수 없습니다.",
          },
        };
      const defaultPrinter = await this.adapter.getDefaultPrinter();
      const printer =
        printers.find((item) => item.id === preferredPrinterId) ??
        printers.find((item) => item.id === defaultPrinter?.id) ??
        (printers.length === 1 ? printers[0] : null);
      if (!printer) {
        return {
          printers,
          diagnostic: {
            status: "MULTIPLE_PRINTERS",
            printer: null,
            message: "검색된 프린터 중 사용할 장치를 선택해 주세요.",
          },
        };
      }
      return {
        printers,
        diagnostic: { status: "READY", printer, message: `${printer.name} 프린터를 사용할 수 있습니다.` },
      };
    } catch (error) {
      const code = error instanceof Error ? error.message : "ERROR";
      if (code === "BROWSER_PRINT_SDK_MISSING")
        return {
          printers: [],
          diagnostic: { status: code, printer: null, message: "Browser Print 웹 연동 파일이 준비되지 않았습니다." },
        };
      if (code === "BROWSER_PRINT_NOT_RUNNING")
        return {
          printers: [],
          diagnostic: {
            status: code,
            printer: null,
            message: "Browser Print가 설치되지 않았거나 실행 중이 아닙니다.",
          },
        };
      return {
        printers: [],
        diagnostic: { status: "ERROR", printer: null, message: "프린터 환경을 확인하지 못했습니다." },
      };
    }
  }

  async diagnose(): Promise<PrinterDiagnostic> {
    return (await this.discover()).diagnostic;
  }

  async testPrint(printer: NonNullable<PrinterDiagnostic["printer"]>) {
    await this.adapter.send(printer, TEST_ZPL);
  }

  async sendRaw(printer: NonNullable<PrinterDiagnostic["printer"]>, rawData: string) {
    await this.adapter.send(printer, rawData);
  }
}
