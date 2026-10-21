// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PseudonymAssignment } from "../../shared/api/pseudonyms";
import { OperationRosterPanel } from "./OperationRosterPanel";
import { operationColumnsFor, type OperationRow } from "./operation-view-model";

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
  it.each([
    { closed: false, absent: false, processed: false, count: "-", rate: "-", shaded: false },
    { closed: false, absent: true, processed: false, count: "1", rate: "100.0", shaded: true },
    { closed: true, absent: false, processed: false, count: "1", rate: "100.0", shaded: true },
    { closed: true, absent: false, processed: true, count: "0", rate: "0.0", shaded: false },
  ])(
    "결시 확정 상태에 따라 통계 표시와 행 음영을 적용한다: %j",
    ({ closed, absent, processed, count, rate, shaded }) => {
      const row: OperationRow = {
        candidate: {
          id: 1,
          examineeNo: "10001",
          name: "홍길동",
          absent,
          birthDate: "",
          examName: "시험",
          examDate: "",
          roomName: "",
          waitingRoom: "",
          seatNo: "",
          labelBarcode: "",
          preassignedNumber: null,
          preassignedAvailable: false,
          assignedNumber: null,
          assignmentMode: null,
          assignedAt: null,
          status: "ACTIVE",
          examTime: "",
          examEndTime: "",
          periodName: "",
          periodCode: "",
          admissionName: "",
          admissionCode: "",
          unitName: "",
          unitCode: "",
          majorName: "",
          majorCode: "",
          buildingName: "",
          buildingCode: "",
          roomCode: "",
          groupName: "",
          opt1: "",
          opt2: "",
          opt3: "",
        },
        assignment: processed ? assignment : null,
      };
      const { container } = render(
        <OperationRosterPanel
          rows={[row]}
          allRows={[row]}
          selectedExamineeNo="10001"
          columns={operationColumnsFor(false)}
          context={{ operationClosed: closed, labelPrintingEnabled: false }}
          grid={{ sort: null, filters: {}, cycleSort: vi.fn(), openFilter: vi.fn() }}
          state={{
            operationStatusLoaded: true,
            operationClosed: closed,
            closingOperation: false,
            rosterRefreshing: false,
            exportingExcel: false,
            labelPrintingEnabled: false,
            printerDiagnostic: { status: "READY", printer: null, message: "" },
            printerDiagnosticBusy: false,
            assignment: null,
            printing: false,
            labelCopiesValid: true,
          }}
          actions={{
            recheckPrinter: vi.fn(),
            refresh: vi.fn(),
            openCloseConfirm: vi.fn(),
            openPrint: vi.fn(),
            download: vi.fn(),
            printLabel: vi.fn(),
            select: vi.fn(),
          }}
        />,
      );
      const stats = Array.from(container.querySelectorAll(".operator-roster-stats strong"));
      const statsRegion = container.querySelector(".operator-roster-stats");
      expect(statsRegion).toHaveAttribute("aria-label", "응시 통계");
      expect(statsRegion?.previousElementSibling).toHaveClass("operator-roster-table-wrap");
      expect(container.querySelector(".operator-roster-heading .operator-roster-stats")).toBeNull();
      expect(container.querySelector(".operator-roster-heading-content")).toBeNull();
      expect(stats[3]).toHaveTextContent(count);
      expect(stats[4]).toHaveTextContent(rate);
      const dataRow = container.querySelector("tr[data-roster-index]");
      expect(dataRow).toHaveClass("is-selected");
      if (shaded) expect(dataRow).toHaveClass("is-absent");
      else expect(dataRow).not.toHaveClass("is-absent");
    },
  );

  it.each([false, true])(
    "그리드 작업 버튼을 표시하고 출력 완료 여부(%s)에 따라 라벨 출력을 제한한다",
    (labelAlreadyPrinted) => {
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
            labelCopiesValid: true,
            labelAlreadyPrinted,
          }}
          actions={{
            recheckPrinter: vi.fn(),
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
        container.querySelectorAll<HTMLButtonElement>(".operator-roster-heading > div > button"),
      );
      expect(buttons.map((button) => button.textContent?.trim())).toEqual([
        "라벨 출력",
        "운영 마감",
        "양식 인쇄",
        "새로고침",
        "삭제",
        "다운로드",
      ]);
      expect(buttons[3]).toHaveAccessibleName("새로고침");
      expect(buttons[4]).toHaveAccessibleName("삭제");
      expect(buttons[4]).toBeDisabled();
      expect(buttons[5]).toHaveAccessibleName("다운로드");
      expect(buttons[0]).toHaveClass("operator-roster-label-button");
      expect(container.querySelector(".operator-printer-status")?.textContent).toContain("연결됨");
      fireEvent.click(buttons[0]!);
      if (labelAlreadyPrinted) {
        expect(buttons[0]).toBeDisabled();
        expect(printLabel).not.toHaveBeenCalled();
      } else expect(printLabel).toHaveBeenCalledOnce();
    },
  );
});
