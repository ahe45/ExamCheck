import type { PrinterDiagnostic, PrinterMode } from "../printer/printer.types";

export type InstallationCheckStatus = "PENDING" | "CHECKING" | "VERIFIED" | "ACTION_REQUIRED" | "SIMULATED";

export interface InstallationCheck {
  id: "WINDOWS_DRIVER" | "BROWSER_PRINT" | "USB_PRINTER";
  step: string;
  title: string;
  status: InstallationCheckStatus;
  statusLabel: string;
  description: string;
}

export interface InstallationReport {
  checks: InstallationCheck[];
  ready: boolean;
  summary: string;
}

export function buildInstallationReport(
  diagnostic: PrinterDiagnostic,
  mode: PrinterMode,
  checking = false,
): InstallationReport {
  if (mode === "mock") {
    return {
      ready: diagnostic.status === "READY",
      summary: "Mock 모드에서는 실제 PC의 설치 상태를 검사하지 않습니다.",
      checks: [
        check(
          "WINDOWS_DRIVER",
          "01",
          "Windows 프린터 드라이버",
          "SIMULATED",
          "확인 안 함",
          "Mock 모드에서는 Windows 드라이버를 검사하지 않습니다.",
        ),
        check(
          "BROWSER_PRINT",
          "02",
          "Zebra Browser Print",
          "SIMULATED",
          "확인 안 함",
          "Mock Printer가 Browser Print 동작을 대신합니다.",
        ),
        check(
          "USB_PRINTER",
          "03",
          "Zebra GT800 USB",
          diagnostic.status === "READY" ? "VERIFIED" : "PENDING",
          diagnostic.status === "READY" ? "Mock 준비됨" : "검사 전",
          diagnostic.message,
        ),
      ],
    };
  }

  if (checking || diagnostic.status === "INITIALIZING") {
    const status = checking ? "CHECKING" : "PENDING";
    const label = checking ? "확인 중" : "검사 전";
    const description = checking ? "PC의 설치 및 연결 상태를 확인하고 있습니다." : "설치 상태 검사를 실행해 주세요.";
    return {
      ready: false,
      summary: description,
      checks: [
        check("WINDOWS_DRIVER", "01", "Windows 프린터 드라이버", status, label, description),
        check("BROWSER_PRINT", "02", "Zebra Browser Print", status, label, description),
        check("USB_PRINTER", "03", "Zebra GT800 USB", status, label, description),
      ],
    };
  }

  const browserPrintVerified = ["READY", "PRINTER_NOT_FOUND", "MULTIPLE_PRINTERS"].includes(diagnostic.status);
  const printStackVerified = ["READY", "MULTIPLE_PRINTERS"].includes(diagnostic.status);
  const windowsDriver = printStackVerified
    ? check(
        "WINDOWS_DRIVER",
        "01",
        "Windows 프린터 드라이버",
        "VERIFIED",
        "동작 확인됨",
        "Browser Print에서 Zebra 프린터가 검색되어 드라이버 동작을 간접 확인했습니다.",
      )
    : check(
        "WINDOWS_DRIVER",
        "01",
        "Windows 프린터 드라이버",
        diagnostic.status === "PRINTER_NOT_FOUND" ? "ACTION_REQUIRED" : "PENDING",
        diagnostic.status === "PRINTER_NOT_FOUND" ? "확인 필요" : "확인 보류",
        "드라이버 설치, USB 연결 및 프린터 전원을 함께 확인해 주세요.",
      );
  const browserPrint = browserPrintVerified
    ? check(
        "BROWSER_PRINT",
        "02",
        "Zebra Browser Print",
        "VERIFIED",
        "실행 중",
        "로컬 Browser Print 서비스가 응답했습니다.",
      )
    : check(
        "BROWSER_PRINT",
        "02",
        "Zebra Browser Print",
        "ACTION_REQUIRED",
        diagnostic.status === "BROWSER_PRINT_SDK_MISSING" ? "연동 준비 필요" : "확인 필요",
        diagnostic.status === "BROWSER_PRINT_SDK_MISSING"
          ? "웹 연동 파일이 서버에 없습니다. 시스템 관리자에게 문의해 주세요."
          : "Browser Print가 설치되지 않았거나 실행 중이 아닙니다.",
      );
  let usbPrinter: InstallationCheck;
  if (diagnostic.status === "READY") {
    usbPrinter = check(
      "USB_PRINTER",
      "03",
      "Zebra GT800 USB",
      "VERIFIED",
      "연결됨",
      `${diagnostic.printer?.name || "Zebra GT800"} 장치가 검색되었습니다.`,
    );
  } else if (["BROWSER_PRINT_SDK_MISSING", "BROWSER_PRINT_NOT_RUNNING", "ERROR"].includes(diagnostic.status)) {
    usbPrinter = check(
      "USB_PRINTER",
      "03",
      "Zebra GT800 USB",
      "PENDING",
      "확인 보류",
      "Browser Print가 준비된 후 USB 프린터를 검사할 수 있습니다.",
    );
  } else {
    usbPrinter = check(
      "USB_PRINTER",
      "03",
      "Zebra GT800 USB",
      "ACTION_REQUIRED",
      diagnostic.status === "MULTIPLE_PRINTERS" ? "선택 필요" : "확인 필요",
      diagnostic.status === "MULTIPLE_PRINTERS"
        ? "프린터가 여러 대입니다. 운영 프린터를 한 대로 정리해 주세요."
        : "USB 케이블, 프린터 전원 및 Windows 장치 인식을 확인해 주세요.",
    );
  }

  return {
    checks: [windowsDriver, browserPrint, usbPrinter],
    ready: diagnostic.status === "READY",
    summary: diagnostic.status === "READY" ? "필수 프로그램과 GT800 연결이 모두 확인되었습니다." : diagnostic.message,
  };
}

function check(
  id: InstallationCheck["id"],
  step: string,
  title: string,
  status: InstallationCheckStatus,
  statusLabel: string,
  description: string,
): InstallationCheck {
  return { id, step, title, status, statusLabel, description };
}
