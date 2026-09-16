// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fetchOperationSchedules, type OperationSchedule } from "../../shared/api/examinees";
import { OperationSchedulePage } from "./OperationSchedulePage";

vi.mock("../../shared/api/examinees", () => ({ fetchOperationSchedules: vi.fn() }));

const schedule: OperationSchedule = {
  date: "2026-10-30",
  time: "09:00",
  periodName: "1교시",
  admissionName: "면접",
  buildingNames: ["본관"],
  candidateCount: 10,
  assignedCount: 10,
  printedCount: 3,
  labelPrintingEnabled: true,
};

describe("OperationSchedulePage", () => {
  it("교시마다 출력 설정에 맞는 완료 인원과 진행률을 표시한다", async () => {
    const schedules = [
      schedule,
      { ...schedule, time: "10:00", periodName: "2교시", printedCount: 0 },
      { ...schedule, time: "11:00", periodName: "3교시", labelPrintingEnabled: false, assignedCount: 4 },
      { ...schedule, time: "12:00", periodName: "4교시", labelPrintingEnabled: false },
      { ...schedule, time: "13:00", periodName: "5교시", candidateCount: 0, assignedCount: 0, printedCount: 0 },
    ];
    vi.mocked(fetchOperationSchedules).mockResolvedValue(schedules);
    const onSelect = vi.fn();
    render(
      <OperationSchedulePage
        token="token"
        user={{ id: 7, loginId: "operator", role: "OPERATOR", admissionNames: ["면접"] }}
        systemProfile={{
          schoolName: "학교",
          academicYear: 2026,
          systemName: "가번호 관리",
          examineeNoUniqueness: "SYSTEM",
          pseudonymNoUniqueness: "ADMISSION",
          logoFileName: null,
          logoDataUrl: null,
          updatedAt: "2026-09-01",
        }}
        onSelect={onSelect}
        onLogout={vi.fn()}
      />,
    );
    await screen.findByRole("progressbar", { name: "1교시 출력 완료" });
    for (const [index, completed, label, width] of [
      [1, 3, "출력 완료", "30%"],
      [2, 0, "출력 완료", "0%"],
      [3, 4, "부여 완료", "40%"],
      [4, 10, "부여 완료", "100%"],
      [5, 0, "출력 완료", "0%"],
    ] as const) {
      const progress = screen.getByRole("progressbar", { name: `${index}교시 ${label}` });
      expect(progress).toHaveAttribute("aria-valuenow", String(completed));
      expect(progress.firstElementChild).toHaveStyle({ width });
      const card = within(progress.closest("button")!);
      expect(card.getByText(label, { exact: false })).toHaveTextContent(`${label} ${completed}명`);
      expect(card.queryByText(label === "출력 완료" ? "부여 완료" : "출력 완료", { exact: false })).toBeNull();
    }
    fireEvent.click(screen.getByRole("progressbar", { name: "1교시 출력 완료" }).closest("button")!);
    expect(onSelect).toHaveBeenCalledWith(schedule);
  });
});
