import type { MouseEvent } from "react";
import { RefreshButtonIcon } from "../../shared/components/ActionIcons";
import { ClientGridHeaderCell } from "../../shared/components/ClientGridHeaderCell";
import type { GridFilters, GridSort } from "../../shared/hooks/useClientDataGrid";
import type { PseudonymAssignment } from "../../shared/api/pseudonyms";
import type { PrinterDiagnostic } from "../printer/printer.types";
import {
  operationRosterStats,
  operationRowValue,
  type OperationColumn,
  type OperationFieldKey,
  type OperationGridContext,
  type OperationRow,
} from "./operation-view-model";

interface RosterGridProps {
  sort: GridSort<OperationFieldKey> | null;
  filters: GridFilters<OperationFieldKey>;
  cycleSort(key: OperationFieldKey): void;
  openFilter(event: MouseEvent<HTMLButtonElement>, key: OperationFieldKey): void;
}

interface RosterState {
  operationStatusLoaded: boolean;
  operationClosed: boolean;
  closingOperation: boolean;
  rosterRefreshing: boolean;
  exportingExcel: boolean;
  labelPrintingEnabled: boolean;
  printerDiagnostic: PrinterDiagnostic;
  printerDiagnosticBusy: boolean;
  assignment: PseudonymAssignment | null;
  printing: boolean;
}

interface RosterActions {
  refresh(): void;
  openCloseConfirm(): void;
  openPrint(): void;
  download(): void;
  printLabel(): void;
  select(examineeNo: string): void;
}

interface Props {
  rows: OperationRow[];
  allRows: OperationRow[];
  selectedExamineeNo?: string;
  columns: OperationColumn[];
  context: OperationGridContext;
  grid: RosterGridProps;
  state: RosterState;
  actions: RosterActions;
}

export function OperationRosterPanel({
  rows,
  allRows,
  selectedExamineeNo,
  columns,
  context,
  grid,
  state,
  actions,
}: Props) {
  const stats = operationRosterStats(allRows, context);
  const printerReady = state.printerDiagnostic.status === "READY" && Boolean(state.printerDiagnostic.printer);

  return (
    <section className="operator-roster-panel">
      <header className="operator-roster-heading">
        <div className="operator-roster-stats">
          <div>
            <span>전체(명)</span>
            <strong>{stats.totalCount}</strong>
          </div>
          <div>
            <span>응시(명)</span>
            <strong>{stats.presentCount}</strong>
          </div>
          <div>
            <span>응시율(%)</span>
            <strong>{stats.attendanceRateText}</strong>
          </div>
        </div>
        <div>
          {state.labelPrintingEnabled && (
            <>
              <span
                className={`operator-printer-status ${state.printerDiagnosticBusy ? "checking" : printerReady ? "ready" : "error"}`}
                role="status"
                aria-live="polite"
                title={state.printerDiagnostic.message}
              >
                <i aria-hidden="true" />
                {state.printerDiagnosticBusy
                  ? "프린터 확인 중"
                  : printerReady
                    ? "프린터 연결 정상"
                    : "프린터 연결 확인 필요"}
              </span>
              <button
                className="operator-roster-label-button"
                onClick={actions.printLabel}
                disabled={!state.assignment || state.printing || !printerReady}
                title={printerReady ? "선택한 수험생의 라벨 출력" : state.printerDiagnostic.message}
              >
                <OperatorPrintIcon />
                {state.printing ? "전송 중…" : "라벨 출력"}
              </button>
            </>
          )}
          <button
            className={`operator-operation-close-button ${state.operationClosed ? "closed" : ""}`}
            onClick={actions.openCloseConfirm}
            disabled={!state.operationStatusLoaded || state.operationClosed || state.closingOperation}
          >
            <OperatorFinishIcon />
            {state.operationClosed ? "등록 마감 완료" : "등록 완료(마감)"}
          </button>
          <button
            className="operator-template-print-button"
            onClick={actions.openPrint}
            disabled={!state.operationStatusLoaded || !state.operationClosed}
            title={state.operationClosed ? "인쇄 양식 선택" : "등록 완료(마감) 후 사용할 수 있습니다."}
          >
            <OperatorPrintIcon />
            인쇄
          </button>
          <button
            className="operator-refresh-button"
            onClick={actions.refresh}
            disabled={state.rosterRefreshing}
            title="가번호 등록 현황 새로고침"
          >
            <RefreshButtonIcon />
            {state.rosterRefreshing ? "갱신 중…" : "새로고침"}
          </button>
          <button
            className="operator-download-button"
            onClick={actions.download}
            disabled={state.exportingExcel}
            title="현재 그리드 엑셀 다운로드"
          >
            <OperatorDownloadIcon />
            {state.exportingExcel ? "생성 중…" : "다운로드"}
          </button>
        </div>
      </header>
      <div className="operator-roster-table-wrap">
        <table className={`candidate-data-table operator-roster-table ${rows.length ? "" : "is-empty"}`}>
          <thead>
            <tr>
              <th className="candidate-row-number">순번</th>
              {columns.map((column) => (
                <ClientGridHeaderCell
                  key={column.key}
                  columnKey={column.key}
                  label={column.label}
                  className={`${column.wide ? "candidate-wide-column" : "candidate-compact-column"} operator-roster-column-${column.key}`}
                  sort={grid.sort}
                  filters={grid.filters}
                  onSort={grid.cycleSort}
                  onOpenFilter={grid.openFilter}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr
                  key={row.candidate.examineeNo}
                  className={selectedExamineeNo === row.candidate.examineeNo ? "is-selected" : ""}
                  tabIndex={0}
                  aria-label={`${row.candidate.examineeNo} ${row.candidate.name} 조회`}
                  onClick={() => actions.select(row.candidate.examineeNo)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      actions.select(row.candidate.examineeNo);
                    }
                  }}
                >
                  <td className="candidate-row-number">{index + 1}</td>
                  {columns.map((column) => {
                    const value = operationRowValue(row, column.key, context);
                    const valueClass =
                      column.key === "status"
                        ? `status-${value === "대기" ? "waiting" : value === "진행" ? "progress" : "closed"}`
                        : column.key === "attendance"
                          ? `attendance-${value === "응시" ? "present" : value === "결시" ? "absent" : "pending"}`
                          : "";
                    return (
                      <td
                        key={column.key}
                        className={`${column.wide ? "candidate-wide-column" : "candidate-compact-column"} operator-roster-column-${column.key} ${column.key === "pseudonymNumber" || column.key === "examineeNo" ? "emphasis" : ""}`}
                      >
                        <span className={valueClass}>{value}</span>
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr className="operator-roster-empty">
                <td className="candidate-grid-empty-cell" colSpan={columns.length + 1}>
                  <strong>
                    {allRows.length ? "필터 조건에 맞는 수험생이 없습니다." : "등록된 수험생이 없습니다."}
                  </strong>
                  <span>
                    {allRows.length
                      ? "필터를 초기화하거나 다른 값을 선택해 주세요."
                      : "선택한 전형과 교시의 수험생 데이터를 확인해 주세요."}
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OperatorPrintIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5.2 7V3.4h9.6V7M5 14H3.4V8h13.2v6H15M5.2 11.5h9.6v5.1H5.2z" />
      <path d="M14 9.7h.1" />
    </svg>
  );
}

function OperatorDownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 3.2v8.5M6.7 8.8 10 12.1l3.3-3.3M4 14.2v2.1h12v-2.1" />
    </svg>
  );
}

export function OperatorFinishIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7.2" />
      <path d="m6.7 10.1 2.1 2.2 4.6-4.8" />
    </svg>
  );
}
