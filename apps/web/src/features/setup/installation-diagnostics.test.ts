import { describe, expect, it } from "vitest";
import { buildInstallationReport } from "./installation-diagnostics";

describe("buildInstallationReport", () => {
  it("marks all real checks verified only when a printer is ready", () => {
    const report = buildInstallationReport(
      { status: "READY", printer: { id: "GT800", name: "ZDesigner GT800", connection: "USB" }, message: "준비 완료" },
      "browser-print",
    );
    expect(report.ready).toBe(true);
    expect(report.checks.every((item) => item.status === "VERIFIED")).toBe(true);
  });

  it("does not claim the Windows driver is missing when no printer is found", () => {
    const report = buildInstallationReport(
      { status: "PRINTER_NOT_FOUND", printer: null, message: "프린터를 찾을 수 없습니다." },
      "browser-print",
    );
    expect(report.ready).toBe(false);
    expect(report.checks[0].statusLabel).toBe("확인 필요");
    expect(report.checks[1].status).toBe("VERIFIED");
  });

  it("labels mock checks as simulated rather than installed", () => {
    const report = buildInstallationReport(
      { status: "READY", printer: { id: "mock", name: "Mock GT800", connection: "MOCK" }, message: "준비 완료" },
      "mock",
    );
    expect(report.ready).toBe(true);
    expect(report.checks[0].status).toBe("SIMULATED");
    expect(report.checks[1].status).toBe("SIMULATED");
  });

  it("defers driver and USB claims when the web integration SDK is missing", () => {
    const report = buildInstallationReport(
      { status: "BROWSER_PRINT_SDK_MISSING", printer: null, message: "연동 파일 없음" },
      "browser-print",
    );
    expect(report.checks[0].status).toBe("PENDING");
    expect(report.checks[1].status).toBe("ACTION_REQUIRED");
    expect(report.checks[2].statusLabel).toBe("확인 보류");
  });
});
