import type { CandidateFieldKey, CandidateRecord } from "../../shared/api/candidates";
import { ClientGridFilterLayer, ClientGridPagination } from "../../shared/components/ClientDataGridControls";
import { ClientGridHeaderCell } from "../../shared/components/ClientGridHeaderCell";
import { useClientDataGrid } from "../../shared/hooks/useClientDataGrid";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import { candidateColumns, candidateWideColumnKeys } from "./candidate-data-model";

interface CandidateDataGridProps {
  loading: boolean;
  grid: ReturnType<typeof useClientDataGrid<CandidateRecord, CandidateFieldKey>>;
}

export function CandidateDataGrid({ loading, grid }: CandidateDataGridProps) {
  useEscapeKey(Boolean(grid.filterMenu), grid.closeFilter);

  return (
    <>
      {loading ? (
        <div className="candidate-grid-empty">수험생 데이터를 불러오는 중입니다.</div>
      ) : (
        <>
          <div className="candidate-table-wrap">
            <table className={`candidate-data-table ${grid.visibleRows.length ? "" : "is-empty"}`}>
              <thead>
                <tr>
                  <th className="candidate-row-number">순번</th>
                  {candidateColumns.map((column) => (
                    <ClientGridHeaderCell
                      key={column.key}
                      columnKey={column.key}
                      label={column.label}
                      className={
                        candidateWideColumnKeys.has(column.key) ? "candidate-wide-column" : "candidate-compact-column"
                      }
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
                      {candidateColumns.map((column) => (
                        <td
                          key={column.key}
                          className={`${candidateWideColumnKeys.has(column.key) ? "candidate-wide-column" : "candidate-compact-column"} ${column.key === "examineeNo" ? "emphasis" : ""}`}
                        >
                          <span>{row[column.key] || "-"}</span>
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="candidate-grid-empty-cell" colSpan={candidateColumns.length + 1}>
                      표시할 수험생 데이터가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <ClientGridPagination
            pageSizes={[30, 50, 100, 200, 500]}
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
      <ClientGridFilterLayer
        loading={grid.filterLoading}
        columns={candidateColumns}
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
    </>
  );
}
