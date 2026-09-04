// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PseudonymAssignment } from "../../shared/api/pseudonyms";
import { OperationRosterPanel } from "./OperationRosterPanel";
import { operationColumnsFor } from "./operation-view-model";

const assignment: PseudonymAssignment = {
  id: 1,
  examineeNo: "10001",
  examineeName: "홍길동",
  examName: "2026년도 자격시험",
  pseudonymNumber: "0821",
  mode: "PREASSIGNED",
  assignedAt: "",
  alreadyAssigned: true,
};

describe("OperationRosterPanel", () => {
  it("그리드 작업 버튼을 지정된 순서로 표시한다", () => {
    const printLabel = vi.fn();
    const { container } = render(
      <OperationRosterPanel
        rows={[]}
        allRows={[]}
        columns={operationColumnsFor(true)}
        context={{ operationClosed: false, labelPrintingEnabled: true }}
        grid={{ sort: null, filters: {}, cycleSort: vi.fn(), openFilter: vi.fn() }}
        state={{
          operationStatusLoaded: true,
          operationClosed: false,
          closingOperation: false,
          rosterRefreshing: false,
          exportingExcel: false,
          labelPrintingEnabled: true,
          printerDiagnostic: {
            status: "READY",
            printer: { id: "GT800", name: "접수처 프린터", connection: "USB" },
            message: "접수처 프린터를 사용할 수 있습니다.",
          },
          printerDiagnosticBusy: false,
          assignment,
          printing: false,
        }}
        actions={{
          printLabel,
          openCloseConfirm: vi.fn(),
          openPrint: vi.fn(),
          refresh: vi.fn(),
          download: vi.fn(),
          select: vi.fn(),
        }}
      />,
    );

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".operator-roster-heading > div:last-child > button"),
    );
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "라벨 출력",
      "등록 완료(마감)",
      "인쇄",
      "새로고침",
      "다운로드",
    ]);
    expect(buttons[0]).toHaveClass("operator-roster-label-button");
    expect(container.querySelector(".operator-printer-status")?.textContent).toContain("프린터 연결 정상");
    fireEvent.click(buttons[0]!);
    expect(printLabel).toHaveBeenCalledOnce();
  });
});
