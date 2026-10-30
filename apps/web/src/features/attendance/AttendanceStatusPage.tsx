import { useEffect, useMemo, useState } from "react";
import { fetchCandidateAttendance, type CandidateAttendanceRecord } from "../../shared/api/candidates";
import { attendanceViews, type AttendanceView } from "../../shared/navigation/admin-navigation";
import { useClientDataGrid } from "../../shared/hooks/useClientDataGrid";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import { ClientGridHeaderCell } from "../../shared/components/ClientGridHeaderCell";
import { ClientGridFilterLayer, ClientGridPagination } from "../../shared/components/ClientDataGridControls";
import { RefreshButtonIcon, ResetButtonIcon } from "../../shared/components/ActionIcons";
import {
  attendanceDimensions,
  attendanceLabels,
  attendanceMetrics,
  attendanceTotals,
  attendanceValue,
  buildAttendanceRows,
  type AttendanceColumn,
} from "./attendance-model";
import "./attendance.css";

export default function AttendanceStatusPage({
  token,
  view,
  recordFilter,
}: {
  token: string;
  view: AttendanceView;
  recordFilter?: (record: CandidateAttendanceRecord) => boolean;
}) {
  const [records, setRecords] = useState<CandidateAttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [filterReset, setFilterReset] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetchCandidateAttendance(token, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setRecords(data);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setRecords([]);
          setError(reason instanceof Error ? reason.message : "응시 현황을 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, refresh]);

  const columns = useMemo(
    () =>
      [...attendanceDimensions[view], ...(view === "candidate" ? [] : attendanceMetrics)].map((key) => ({
        key,
        label: attendanceLabels[key],
      })),
    [view],
  );
  const rows = useMemo(
    () => buildAttendanceRows(recordFilter ? records.filter(recordFilter) : records, view),
    [records, view, recordFilter],
  );
  const grid = useClientDataGrid<ReturnType<typeof buildAttendanceRows>[number], AttendanceColumn>({
    rows,
    valueOf: attendanceValue,
    resetKey: `${view}:${filterReset}`,
  });
  const totals = useMemo(() => attendanceTotals(grid.filteredRows), [grid.filteredRows]);
  useEscapeKey(Boolean(grid.filterMenu), grid.closeFilter);
  const label = attendanceViews.find((item) => item.key === view)!.label;

  return (
    <section className="candidate-data-view attendance-status-view" aria-label={`${label} 응시 현황`}>
      <article className="candidate-data-card attendance-grid-card">
        <header className="candidate-data-header">
          <div>
            <h2>{label} 응시 현황</h2>
            <p>열별로 정렬하거나 필요한 값만 필터링하여 응시·결시 현황을 확인합니다.</p>
          </div>
          <div className="candidate-data-actions">
            <button
              className="exam-outline-button"
              type="button"
              onClick={() => setRefresh((value) => value + 1)}
              disabled={loading}
            >
              <RefreshButtonIcon />
              <span>{loading ? "불러오는 중…" : "새로고침"}</span>
            </button>
            <button className="exam-outline-button" type="button" onClick={() => setFilterReset((value) => value + 1)}>
              <ResetButtonIcon />
              <span>필터 초기화</span>
            </button>
          </div>
        </header>
        <div className="attendance-summary">
          {error && (
            <p className="attendance-error" role="alert">
              {error}
            </p>
          )}
          <div className="attendance-stat-cards" aria-label="응시 통계" aria-busy={loading}>
            {attendanceMetrics.map((metric) => {
              const isRate = metric === "presentRate" || metric === "absentRate";
              const count = metric === "presentRate" ? totals.present : totals.absent;
              const rate = totals.total ? Math.max(0, Math.min(100, (count / totals.total) * 100)) : 0;
              return (
                <article key={metric} className={`attendance-stat-card metric-${metric}`}>
                  <span>{attendanceLabels[metric]}</span>
                  <strong>
                    {loading || error ? "—" : isRate ? rate.toFixed(1) : totals[metric].toLocaleString("ko-KR")}
                    {!loading && !error && <small>{isRate ? "%" : "명"}</small>}
                  </strong>
                  <span className="attendance-stat-icon" aria-hidden="true">
                    <AttendanceStatIcon metric={metric} />
                  </span>
                  {isRate && (
                    <div
                      className="attendance-stat-track"
                      role="progressbar"
                      aria-label={attendanceLabels[metric]}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={loading || error ? undefined : Number(rate.toFixed(1))}
                      aria-valuetext={loading || error ? "불러오는 중" : `${rate.toFixed(1)}%`}
                    >
                      <i style={{ width: `${loading || error ? 0 : rate}%` }} />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
        {loading ? (
          <div className="candidate-grid-empty" role="status">
            응시 현황을 불러오는 중입니다.
          </div>
        ) : error ? (
          <div className="candidate-grid-empty">새로고침으로 다시 시도해 주세요.</div>
        ) : (
          <>
            <div className="candidate-table-wrap">
              <table className="candidate-data-table attendance-data-table" aria-label={`${label} 응시 현황 그리드`}>
                <thead>
                  <tr>
                    <th scope="col" className="candidate-row-number">
                      순번
                    </th>
                    {columns.map((column) => (
                      <ClientGridHeaderCell
                        key={column.key}
                        columnKey={column.key}
                        label={column.label}
                        sort={grid.sort}
                        filters={grid.filters}
                        onSort={grid.cycleSort}
                        onOpenFilter={grid.openFilter}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.visibleRows.length ? (
                    grid.visibleRows.map((row, index) => (
                      <tr key={row.id}>
                        <td className="candidate-row-number">{grid.startIndex + index + 1}</td>
                        {columns.map((column) => (
                          <td
                            key={column.key}
                            className={attendanceMetrics.some((key) => key === column.key) ? "attendance-number" : ""}
                          >
                            {attendanceValue(row, column.key)}
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={columns.length + 1} className="candidate-grid-empty-cell">
                        표시할 응시 현황이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <ClientGridPagination
              count={grid.count}
              page={grid.currentPage}
              pageSize={grid.pageSize}
              totalPages={grid.totalPages}
              start={grid.count ? grid.startIndex + 1 : 0}
              end={grid.startIndex + grid.visibleRows.length}
              onPage={grid.setPage}
              onPageSize={grid.setPageSize}
            />
          </>
        )}
      </article>
      <ClientGridFilterLayer
        columns={columns}
        menu={grid.filterMenu}
        search={grid.filterSearch}
        draft={grid.filterDraft}
        options={grid.filterOptions}
        onSearch={grid.setFilterSearch}
        onToggleOption={grid.toggleFilterOption}
        onToggleVisible={grid.toggleVisibleFilterOptions}
        onClose={grid.closeFilter}
        onReset={grid.resetFilter}
        onApply={grid.applyFilter}
      />
    </section>
  );
}

function AttendanceStatIcon({ metric }: { metric: (typeof attendanceMetrics)[number] }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {metric === "presentRate" || metric === "absentRate" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          {metric === "presentRate" ? <path d="m8.5 12 2.3 2.3 4.7-5" /> : <path d="m9.5 9.5 5 5m0-5-5 5" />}
        </>
      ) : (
        <>
          <circle cx="10" cy="7" r="3" />
          <path d="M3.5 19v-1.5a6.5 6.5 0 0 1 13 0V19a13 13 0 0 1-13 0Z" />
          {metric === "absent" ? (
            <path d="M18 11h4" />
          ) : (
            <>
              <circle cx="18.5" cy="8.5" r="2.3" />
              <path d="M18 14a4.7 4.7 0 0 1 4.3 4.7v.3a9 9 0 0 1-3.3.8" />
              {metric === "present" && <path d="m2 10 1.3 1.3L5.5 9" />}
            </>
          )}
        </>
      )}
    </svg>
  );
}
