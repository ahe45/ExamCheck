// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CandidateAttendanceRecord } from "../../shared/api/candidates";
import AttendanceStatusPage from "./AttendanceStatusPage";

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../shared/api/candidates", () => ({ fetchCandidateAttendance: api.fetch }));
const records: CandidateAttendanceRecord[] = Array.from({ length: 65 }, (_, id) => ({
  id,
  admission: id < 60 ? "일반" : "특별",
  unit: "음악",
  major: "피아노",
  group: "1조",
  date: "2026-10-21",
  time: id < 30 ? "09:00" : "13:00",
  period: "1교시",
  building: "본관",
  room: "101",
  waitingRoom: "201",
  examineeNo: String(id),
  name: `수험생${id}`,
  attendance: id < 30 || id === 60 ? "응시" : id < 50 || id > 60 ? "결시" : "대기",
}));
function card(label: string) {
  return within(screen.getByLabelText("응시 통계")).getByText(label).closest("article")!;
}

describe("AttendanceStatusPage", () => {
  it("shows one row per date without time or period columns", async () => {
    api.fetch.mockResolvedValue([
      records[0],
      { ...records[30], period: "2교시" },
      { ...records[60], date: "2026-10-22" },
    ]);
    render(<AttendanceStatusPage token="token" view="date" />);
    const table = within(await screen.findByRole("table"));
    expect(table.getByRole("button", { name: "날짜 필터" })).toBeInTheDocument();
    expect(table.queryByRole("button", { name: "시간 필터" })).not.toBeInTheDocument();
    expect(table.queryByRole("button", { name: "교시 필터" })).not.toBeInTheDocument();
    const rows = table.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(
      within(rows[1])
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["1", "2026-10-21", "2", "1", "1", "50.0%", "50.0%"]);
  });

  it("recalculates weighted cards from column filters and resets filters without a search field", async () => {
    api.fetch.mockResolvedValue(records);
    render(<AttendanceStatusPage token="token" view="admission" />);
    await screen.findByRole("button", { name: "전형 필터" });
    expect(card("전체인원")).toHaveTextContent("65명");
    expect(card("응시인원")).toHaveTextContent("31명");
    expect(card("응시율")).toHaveTextContent("47.7%");
    fireEvent.click(screen.getByRole("button", { name: "전형 필터" }));
    const dialog = within(screen.getByRole("dialog", { name: "전형 필터" }));
    fireEvent.click(dialog.getByLabelText("일반"));
    fireEvent.click(dialog.getByRole("button", { name: "적용" }));
    expect(card("전체인원")).toHaveTextContent("5명");
    expect(card("응시인원")).toHaveTextContent("1명");
    expect(card("결시인원")).toHaveTextContent("4명");
    expect(card("응시율")).toHaveTextContent("20.0%");
    expect(card("결시율")).toHaveTextContent("80.0%");
    fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
    expect(card("전체인원")).toHaveTextContent("65명");
    fireEvent.click(screen.getByRole("button", { name: "시간 필터" }));
    const timeFilter = within(screen.getByRole("dialog", { name: "시간 필터" }));
    fireEvent.click(timeFilter.getByLabelText("13:00"));
    fireEvent.click(timeFilter.getByRole("button", { name: "적용" }));
    expect(card("전체인원")).toHaveTextContent("30명");
    expect(card("응시율")).toHaveTextContent("100.0%");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
  it("totals all filtered candidates across pages", async () => {
    api.fetch.mockResolvedValue(records);
    render(<AttendanceStatusPage token="token" view="candidate" />);
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(31);
    expect(card("전체인원")).toHaveTextContent("65명");
    fireEvent.click(screen.getByRole("button", { name: "전형 필터" }));
    const dialog = within(screen.getByRole("dialog", { name: "전형 필터" }));
    fireEvent.click(dialog.getByLabelText("일반"));
    fireEvent.click(dialog.getByRole("button", { name: "적용" }));
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(card("전체인원")).toHaveTextContent("5명");
  });
  it("shows a load failure without presenting it as zero attendance", async () => {
    api.fetch.mockRejectedValue(new Error("조회 실패"));
    render(<AttendanceStatusPage token="token" view="admission" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("조회 실패");
    expect(card("전체인원")).toHaveTextContent("—");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
