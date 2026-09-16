// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import type { OperationSchedule } from "../../shared/api/examinees";
import { OperationConsoleHeader } from "./OperationConsoleHeader";

const systemProfile: DeveloperSettings = {
  schoolName: "한국대학교",
  academicYear: 2026,
  systemName: "가번호 관리 시스템",
  examineeNoUniqueness: "SYSTEM",
  pseudonymNoUniqueness: "ADMISSION",
  logoFileName: null,
  logoDataUrl: null,
  updatedAt: "2026-09-03T00:00:00.000Z",
};

const schedule: OperationSchedule = {
  date: "2026-10-30",
  time: "10:00",
  periodName: "1교시",
  admissionName: "면접",
  buildingNames: ["본관"],
  candidateCount: 10,
  assignedCount: 0,
  printedCount: 0,
  labelPrintingEnabled: false,
};

function renderHeader(selectedMode: "PREASSIGNED" | "RANDOM") {
  return render(
    <OperationConsoleHeader
      systemProfile={systemProfile}
      schedule={schedule}
      candidateCount={10}
      selectedMode={selectedMode}
      autoDrawEnabled={false}
      autoDrawDelaySeconds={3}
      range={{ start: 1001, end: 1099 }}
      settingsOpen={false}
      settingsRef={{ current: null }}
      labelPrintingEnabled={selectedMode === "PREASSIGNED"}
      loginId="operator"
      onChangeSchedule={vi.fn()}
      onToggleSettings={vi.fn()}
      onOpenPrinter={vi.fn()}
      onResetHistory={vi.fn()}
      onLogout={vi.fn()}
    />,
  );
}

describe("OperationConsoleHeader", () => {
  it("사전부여 방식에서는 사용하지 않는 가번호 범위 카드를 숨긴다", () => {
    const { container } = renderHeader("PREASSIGNED");

    expect(screen.queryByText("가번호 범위")).not.toBeInTheDocument();
    expect(container.querySelector(".operator-header-summary")).toHaveClass("without-range");
  });

  it("추첨 방식에서는 설정된 가번호 범위를 표시한다", () => {
    renderHeader("RANDOM");

    expect(screen.getByText("가번호 범위")).toBeInTheDocument();
    expect(screen.getByText("1,001 ~ 1,099")).toBeInTheDocument();
  });
});
