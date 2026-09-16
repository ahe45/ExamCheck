// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { PrinterStatus } from "../printer/printer.types";
import { OperationPrinterStatus } from "./OperationPrinterStatus";

it("상태 배지 클릭으로 갱신하고 확인 중이나 출력 중에는 재확인을 막는다", () => {
  const onRecheck = vi.fn();
  const props = {
    diagnostic: {
      status: "READY" as const,
      printer: { id: "1", name: "접수처 GT800", connection: "USB" as const },
      message: "프린터 검색 완료",
    },
    busy: false,
    printing: false,
    onRecheck,
  };
  const { rerender } = render(<OperationPrinterStatus {...props} />);
  expect(screen.getByRole("group", { name: "라벨 프린터" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("연결됨");
  expect(screen.getByRole("button")).toHaveAttribute("title", "연결 새로고침");
  expect(screen.getAllByRole("button")).toHaveLength(1);
  const button = screen.getByRole("button", { name: "연결 새로고침" });
  fireEvent.click(button);
  expect(onRecheck).toHaveBeenCalledOnce();
  rerender(<OperationPrinterStatus {...props} busy />);
  expect(screen.getByRole("status")).toHaveTextContent("확인 중…");
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  fireEvent.click(button);
  rerender(<OperationPrinterStatus {...props} printing />);
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(onRecheck).toHaveBeenCalledOnce();
});

it.each<[PrinterStatus, string]>([
  ["PRINTER_NOT_FOUND", "미연결"],
  ["MULTIPLE_PRINTERS", "미연결"],
  ["BROWSER_PRINT_NOT_RUNNING", "미연결"],
  ["PRINTER_OFFLINE", "미연결"],
  ["ERROR", "미연결"],
])("%s 상태를 미연결로 간소화하고 배지 호버에는 연결 새로고침을 표시한다", (status, label) => {
  render(
    <OperationPrinterStatus
      diagnostic={{ status, printer: null, message: "오류 상세" }}
      busy={false}
      printing={false}
      onRecheck={vi.fn()}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(label);
  expect(screen.getByRole("button")).toHaveAttribute("title", "연결 새로고침");
  expect(screen.getByRole("button")).toBeEnabled();
});
