// @vitest-environment jsdom

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCandidateDashboardSummary } from "../../shared/api/candidates";
import { AdminDashboard } from "./AdminDashboard";
import { buildDashboardStatistics } from "./dashboard-statistics";
import { useAdminDashboard } from "./useAdminDashboard";

vi.mock("../../shared/api/candidates", () => ({ fetchCandidateDashboardSummary: vi.fn() }));

describe("AdminDashboard", () => {
  beforeEach(() => {
    vi.mocked(fetchCandidateDashboardSummary).mockReset();
  });

  it("renders the existing summary and admission statistic cards", () => {
    const statistics = buildDashboardStatistics([
      {
        admission: "학생부교과",
        building: "본관",
        waitingRoom: "101호 대기실",
        date: "2026-09-01",
        time: "09:00",
        period: "1교시",
        assignedNumber: "1001",
      },
      {
        admission: "학생부교과",
        building: "본관",
        waitingRoom: "102호 대기실",
        date: "2026-09-01",
        time: "09:00",
        period: "1교시",
        assignedNumber: null,
      },
      {
        admission: "실기전형",
        building: "별관",
        waitingRoom: "201호 대기실",
        date: "2026-09-01",
        time: "13:00",
        period: "2교시",
        assignedNumber: "2001",
      },
    ]);
    const onRefresh = vi.fn();
    render(
      <AdminDashboard
        statistics={statistics}
        loading={false}
        error={null}
        lastUpdated={new Date("2026-08-28T01:30:00")}
        onRefresh={onRefresh}
        onOpenCandidates={vi.fn()}
      />,
    );

    const heading = screen.getByRole("heading", { name: "전형 운영 대시보드" });
    expect(heading).toBeInTheDocument();
    expect(heading.closest("header")).toHaveClass("admin-view-heading");
    expect(screen.getByRole("heading", { name: "학생부교과" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "실기전형" })).toBeInTheDocument();
    expect(document.querySelectorAll(".admission-status-card")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "운영 현황" })).toBeInTheDocument();
    expect(screen.queryByText(/등록 전형 총/)).not.toBeInTheDocument();
    const breakdownGroup = screen.getByRole("group", { name: "운영 현황 기준" });
    expect(breakdownGroup).toHaveTextContent("전형교시건물대기실");
    expect(breakdownGroup).not.toHaveTextContent("기준");
    expect(document.querySelector(".dashboard-breakdown-control")).toHaveTextContent("분류 기준전형교시건물대기실");
    fireEvent.click(screen.getByRole("button", { name: "건물" }));
    expect(screen.getByRole("heading", { name: "본관" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "별관" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "교시" }));
    expect(screen.getByRole("heading", { name: "1교시 · 2026.09.01 09:00" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "대기실" }));
    expect(screen.getByRole("heading", { name: "본관 · 101호 대기실" })).toBeInTheDocument();
    expect(document.querySelector(".admission-donut")).toHaveStyle({ "--assigned-angle": "240.12deg" });
    const refreshButton = screen.getByRole("button", { name: "새로고침" });
    expect(refreshButton).toHaveClass("exam-outline-button");
    fireEvent.click(refreshButton);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("keeps the empty-state navigation and dashboard error message", () => {
    const onOpenCandidates = vi.fn();
    render(
      <AdminDashboard
        statistics={buildDashboardStatistics([])}
        loading={false}
        error="대시보드 오류"
        lastUpdated={null}
        onRefresh={vi.fn()}
        onOpenCandidates={onOpenCandidates}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("대시보드 오류");
    fireEvent.click(screen.getByRole("button", { name: "수험생 데이터로 이동" }));
    expect(onOpenCandidates).toHaveBeenCalledOnce();
  });

  it("loads the server aggregate on mount and refreshes through the same query boundary", async () => {
    vi.mocked(fetchCandidateDashboardSummary)
      .mockResolvedValueOnce(buildDashboardStatistics([{ admission: "학생부교과", assignedNumber: null }]))
      .mockResolvedValueOnce(buildDashboardStatistics([{ admission: "학생부교과", assignedNumber: "1001" }]));

    const { result } = renderHook(() => useAdminDashboard("session-token"), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchCandidateDashboardSummary).toHaveBeenCalledWith("session-token");
    expect(result.current.statistics.assignedCandidates).toBe(0);

    await act(async () => {
      await result.current.refresh();
    });
    expect(fetchCandidateDashboardSummary).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.statistics.assignedCandidates).toBe(1));
  });

  it("does not request dashboard data while another administrator menu is active", async () => {
    const { result } = renderHook(() => useAdminDashboard("session-token", false), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchCandidateDashboardSummary).not.toHaveBeenCalled();
  });
});

function queryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function QueryWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
