import type { Account } from "../../shared/api/accounts";
import { DeleteButtonIcon, EditButtonIcon } from "../../shared/components/ActionIcons";
import { ClientGridFilterLayer, ClientGridPagination } from "../../shared/components/ClientDataGridControls";
import { ClientGridHeaderCell } from "../../shared/components/ClientGridHeaderCell";
import { useClientDataGrid } from "../../shared/hooks/useClientDataGrid";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import { accountColumns, accountColumnValue, type AccountColumnKey } from "./account-management-model";

interface AccountDataGridProps {
  accounts: Account[];
  currentUserId: number;
  loading: boolean;
  onEdit(account: Account): void;
  onDelete(account: Account): void;
}

export function AccountDataGrid({ accounts, currentUserId, loading, onEdit, onDelete }: AccountDataGridProps) {
  const grid = useClientDataGrid<Account, AccountColumnKey>({
    rows: accounts,
    valueOf: accountColumnValue,
  });
  useEscapeKey(Boolean(grid.filterMenu), grid.closeFilter);

  return (
    <>
      {loading ? (
        <div className="candidate-grid-empty">계정 정보를 불러오는 중입니다.</div>
      ) : (
        <>
          <div className="candidate-table-wrap account-table-wrap">
            <table className={`candidate-data-table account-data-table ${grid.visibleRows.length ? "" : "is-empty"}`}>
              <thead>
                <tr>
                  <th className="candidate-row-number">순번</th>
                  {accountColumns.map((column) => (
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
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {grid.visibleRows.length ? (
                  grid.visibleRows.map((account, index) => (
                    <tr key={account.id}>
                      <td className="candidate-row-number">{grid.startIndex + index + 1}</td>
                      <td>
                        <strong>{account.loginId}</strong>
                      </td>
                      <td>
                        <span className={`account-role-badge ${account.role.toLowerCase()}`}>
                          {account.role === "ADMIN" ? "관리자" : "사용자"}
                        </span>
                      </td>
                      <td>
                        {account.role === "ADMIN" || !account.admissionNames.length ? (
                          <span className="account-all-access">전체 전형·교시</span>
                        ) : (
                          <div className="account-admission-tags">
                            {account.admissionNames.map((admission) => (
                              <span key={admission}>{admission}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="account-row-actions">
                          <button onClick={() => onEdit(account)}>
                            <EditButtonIcon />
                            <span>수정</span>
                          </button>
                          <button
                            className="danger"
                            onClick={() => onDelete(account)}
                            disabled={account.id === currentUserId}
                          >
                            <DeleteButtonIcon />
                            <span>삭제</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="candidate-grid-empty-cell" colSpan={5}>
                      등록된 계정이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <ClientGridPagination
            count={grid.filteredRows.length}
            page={grid.currentPage}
            pageSize={grid.pageSize}
            totalPages={grid.totalPages}
            start={grid.filteredRows.length ? grid.startIndex + 1 : 0}
            end={grid.startIndex + grid.visibleRows.length}
            onPage={grid.setPage}
            onPageSize={grid.setPageSize}
          />
        </>
      )}
      <ClientGridFilterLayer
        columns={accountColumns}
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
