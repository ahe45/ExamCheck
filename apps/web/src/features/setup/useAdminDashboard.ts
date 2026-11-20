import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { fetchCandidateDashboardSchedules, fetchCandidateDashboardSummary } from "../../shared/api/candidates";
import { buildDashboardStatistics } from "./dashboard-statistics";

const EMPTY_DASHBOARD = buildDashboardStatistics([]);

export function useAdminDashboard(token: string, enabled = true) {
  const [filters, setFilters] = useState({ date: "", period: "" });
  const {
    data: schedules = [],
    refetch: refetchSchedules,
    error: scheduleError,
  } = useQuery({
    queryKey: ["admin-dashboard-schedules", token],
    queryFn: () => fetchCandidateDashboardSchedules(token),
    enabled: Boolean(token) && enabled,
    retry: false,
  });
  const query = useQuery({
    queryKey: ["admin-dashboard-summary", token, filters],
    queryFn: () => fetchCandidateDashboardSummary(token, filters),
    enabled: Boolean(token) && enabled,
    retry: false,
  });
  const { refetch } = query;

  const refresh = useCallback(async () => {
    await Promise.all([refetch(), refetchSchedules()]);
  }, [refetch, refetchSchedules]);

  const dates = [...new Set(schedules.map(({ date }) => date).filter(Boolean))];
  const periods = [
    ...new Set(
      schedules
        .filter(({ date }) => !filters.date || filters.date === date)
        .map(({ period }) => period)
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  const error = query.error ?? scheduleError;

  return {
    statistics: query.data ?? EMPTY_DASHBOARD,
    loading: query.isFetching,
    error: error instanceof Error ? error.message : error ? "대시보드 데이터를 불러오지 못했습니다." : null,
    lastUpdated: query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : null,
    scheduleFilter: {
      ...filters,
      dates,
      periods,
      onDateChange(date: string) {
        setFilters(({ period }) => ({
          date,
          period: schedules.some((schedule) => (!date || schedule.date === date) && schedule.period === period)
            ? period
            : "",
        }));
      },
      onPeriodChange(period: string) {
        setFilters((current) => ({ ...current, period }));
      },
    },
    refresh,
  };
}
