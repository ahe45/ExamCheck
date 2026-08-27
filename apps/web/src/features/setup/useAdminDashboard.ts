import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { fetchCandidateDashboardSummary } from "../../shared/api/candidates";
import { buildDashboardStatistics } from "./dashboard-statistics";

const EMPTY_DASHBOARD = buildDashboardStatistics([]);

export function useAdminDashboard(token: string, enabled = true) {
  const query = useQuery({
    queryKey: ["admin-dashboard-summary"],
    queryFn: () => fetchCandidateDashboardSummary(token),
    enabled: Boolean(token) && enabled,
    retry: false,
  });
  const { refetch } = query;

  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    statistics: query.data ?? EMPTY_DASHBOARD,
    loading: query.isFetching,
    error:
      query.error instanceof Error
        ? query.error.message
        : query.error
          ? "대시보드 데이터를 불러오지 못했습니다."
          : null,
    lastUpdated: query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : null,
    refresh,
  };
}
