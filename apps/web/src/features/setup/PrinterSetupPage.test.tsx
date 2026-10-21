// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWorkstations } from "../../shared/api/workstations";
import { getWorkstationCode } from "../../shared/config/workstation";
import type { PrinterService } from "../printer/PrinterService";
import type { PrinterDevice } from "../printer/printer.types";
import { PrinterSetupPage } from "./PrinterSetupPage";

vi.mock("../../shared/api/workstations", () => ({ fetchWorkstations: vi.fn() }));
vi.mock("../../shared/api/drivers", () => ({ downloadDriver: vi.fn() }));

const printers: PrinterDevice[] = [
  { id: "GT800-1", name: "접수처 프린터", connection: "USB" },
  { id: "GT800-2", name: "운영실 프린터", connection: "NETWORK" },
];

describe("PrinterSetupPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(fetchWorkstations)
      .mockReset()
      .mockResolvedValue([
        {
          id: 1,
          code: "WS-DEV-001",
          name: "개발용 워크스테이션",
          location: "운영실",
          description: null,
          enabled: true,
        },
        {
          id: 2,
          code: "WS-DISABLED",
          name: "사용 중지 장비",
          location: null,
          description: null,
          enabled: false,
        },
      ]);
  });

  it("검색된 실제 프린터와 서버 워크스테이션을 선택해 저장한다", async () => {
    const onDiagnose = vi.fn().mockResolvedValue(undefined);
    const onSelectPrinter = vi.fn();
    const onClose = vi.fn();
    render(
      <PrinterSetupPage
        mode="browser-print"
        token="operator-token"
        service={{ testPrint: vi.fn() } as unknown as PrinterService}
        diagnostic={{ status: "READY", printer: printers[0], message: "출력 준비 완료" }}
        printers={printers}
        selectedPrinterId="GT800-1"
        busy={false}
        onDiagnose={onDiagnose}
        onSelectPrinter={onSelectPrinter}
        onClose={onClose}
      />,
      { wrapper: queryWrapper() },
    );

    await waitFor(() => expect(fetchWorkstations).toHaveBeenCalledWith("operator-token"));
    await screen.findByRole("option", { name: "개발용 워크스테이션 · WS-DEV-001" });
    expect(onDiagnose).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "프린터 설정" })).toHaveAttribute("aria-modal", "true");
    expect(screen.queryByRole("button", { name: "가번호 부여 화면으로" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "프린터 환경 확인" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "실제 출력 장치 설정" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("라벨 프린터"), { target: { value: "GT800-2" } });
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    expect(onSelectPrinter).toHaveBeenCalledWith("GT800-2");
    expect(getWorkstationCode()).toBe("WS-DEV-001");
    expect(screen.getByText("이 PC의 출력 워크스테이션과 프린터 설정을 저장했습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "프린터 설정 닫기" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

function queryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function QueryWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
