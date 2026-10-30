// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fetchCandidateAttendance, type CandidateAttendanceRecord } from "../../shared/api/candidates";
import { attendanceViews } from "../../shared/navigation/admin-navigation";
import { AdminDashboard } from "./AdminDashboard";
import { buildDashboardStatistics, dashboardGroupName } from "./dashboard-statistics";

vi.mock("../../shared/api/candidates", () => ({ fetchCandidateAttendance: vi.fn() }));

const first: CandidateAttendanceRecord = {
  id: 1,
  admission: "일반",
  unit: "음악",
  major: "피아노",
  group: "1조",
  date: "2026-10-30",
  time: "09:00",
  period: "1교시",
  building: "본관",
  room: "101",
  waitingRoom: "201",
  examineeNo: "1001",
  name: "김수험",
  attendance: "응시",
};
const second: CandidateAttendanceRecord = {
  id: 2,
  admission: "특별",
  unit: "미술",
  major: "회화",
  group: "2조",
  date: "2026-10-31",
  time: "11:00",
  period: "2교시",
  building: "별관",
  room: "102",
  waitingRoom: "202",
  examineeNo: "1002",
  name: "이수험",
  attendance: "결시",
};

describe("dashboard candidate drilldown", () => {
  it.each(attendanceViews.filter((view) => view.key !== "candidate"))(
    "$label 카드에서 해당 수험생만 표시하고 필터 초기화 후에도 조회 범위를 유지한다",
    async ({ key, label }) => {
      vi.mocked(fetchCandidateAttendance).mockResolvedValue([first, second]);
      const statistics = buildDashboardStatistics(
        [first, second].map((record) => ({ ...record, assignedNumber: null })),
      );
      render(
        <AdminDashboard
          token="token"
          statistics={statistics}
          loading={false}
          error={null}
          lastUpdated={null}
          onRefresh={vi.fn()}
          onOpenCandidates={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: label.slice(0, -1) }));
      const trigger = screen.getByRole("button", {
        name: `${dashboardGroupName(first, key)} 수험생 목록`,
      });
      trigger.focus();
      fireEvent.keyDown(trigger, { key: "Enter" });
      const modal = screen.getByRole("dialog", { name: /수험생 목록/ });
      const table = await within(modal).findByRole("table");
      expect(within(table).getByText("김수험")).toBeInTheDocument();
      expect(within(table).queryByText("이수험")).not.toBeInTheDocument();
      expect(
        within(modal).getByText("전체인원", { selector: ".attendance-stat-card > span" }).closest("article"),
      ).toHaveTextContent("1명");
      fireEvent.click(within(modal).getByRole("button", { name: "필터 초기화" }));
      expect(within(table).queryByText("이수험")).not.toBeInTheDocument();
      fireEvent.click(within(modal).getByRole("button", { name: "성명 필터" }));
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: "성명 필터" })).not.toBeInTheDocument();
      expect(modal).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await waitFor(() => expect(trigger).toHaveFocus());
    },
  );
});
