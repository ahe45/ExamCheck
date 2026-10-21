import type { CandidateFieldKey, CandidateRecord } from "../../shared/api/candidates";
import { ClientGridFilterLayer, ClientGridPagination } from "../../shared/components/ClientDataGridControls";
import { ClientGridHeaderCell } from "../../shared/components/ClientGridHeaderCell";
import { useClientDataGrid } from "../../shared/hooks/useClientDataGrid";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import { candidateColumns, candidateWideColumnKeys } from "./candidate-data-model";

interface CandidateDataGridProps {
  loading: boolean;
  onEdit?(candidate: CandidateRecord): void;
  showOptColumns?: boolean;
  grid: ReturnType<typeof useClientDataGrid<CandidateRecord, CandidateFieldKey>>;
}

function columnClassName(key: CandidateFieldKey) {
  if (key === "examineeNo" || key.startsWith("opt")) return "candidate-number-column";
  if (key === "answerSheet") return "candidate-answer-sheet-column";
  return candidateWideColumnKeys.has(key) ? "candidate-wide-column" : "candidate-compact-column";
}

export function CandidateDataGrid({ loading, grid, onEdit, showOptColumns = false }: CandidateDataGridProps) {
  const columns = candidateColumns.filter((column) => showOptColumns || !column.key.startsWith("opt"));
  useEscapeKey(Boolean(grid.filterMenu), grid.closeFilter);

  return (
    <>
      {loading ? (
        <div className="candidate-grid-empty">수험생 데이터를 불러오는 중입니다.</div>
      ) : (
        <>
          <div className="candidate-table-wrap">
            <table
              id="candidate-data-table"
              className={`candidate-data-table ${grid.visibleRows.length ? "" : "is-empty"}`}
            >
              <thead>
                <tr>
                  <th className="candidate-row-number">순번</th>
                  {columns.map((column) => (
                    <ClientGridHeaderCell
                      key={column.key}
                      columnKey={column.key}
                      label={column.label}
                      className={columnClassName(column.key)}
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
                    <tr
                      key={row.id}
                      className={onEdit ? "candidate-editable-row" : undefined}
                      tabIndex={onEdit ? 0 : undefined}
                      aria-label={onEdit ? `${row.name} (${row.examineeNo}) 정보 수정` : undefined}
                      onClick={() => onEdit?.(row)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onEdit?.(row);
                        }
                      }}
                    >
                      <td className="candidate-row-number">{grid.startIndex + index + 1}</td>
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={`${columnClassName(column.key)} ${column.key === "examineeNo" ? "emphasis" : ""}`}
                        >
                          <span>{row[column.key] || "-"}</span>
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="candidate-grid-empty-cell" colSpan={columns.length + 1}>
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
    </>
  );
}
