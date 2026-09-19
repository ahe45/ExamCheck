import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { DeleteButtonIcon, RefreshButtonIcon } from "../../shared/components/ActionIcons";
import { ClientGridHeaderCell } from "../../shared/components/ClientGridHeaderCell";
import type { GridFilters, GridSort } from "../../shared/hooks/useClientDataGrid";
import type { PseudonymAssignment } from "../../shared/api/pseudonyms";
import type { PrinterDiagnostic } from "../printer/printer.types";
import { OperationPrinterStatus } from "./OperationPrinterStatus";
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
  canDeleteHistory?: boolean;
  deletingHistory?: boolean;
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
  labelCopies: number | "";
  labelCopiesValid: boolean;
  labelAlreadyPrinted?: boolean;
  labelTemplateName?: string;
}

interface RosterActions {
  recheckPrinter(): void;
  deleteHistory?(): void;
  refresh(): void;
  openCloseConfirm(): void;
  openPrint(): void;
  download(): void;
  printLabel(): void;
  setLabelCopies(value: number | ""): void;
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
  const stats = useMemo(() => operationRosterStats(allRows, context), [allRows, context]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 700, rowHeight: 48 });
  const virtual = rows.length > 100;
  const first = virtual
    ? Math.min(Math.max(0, Math.floor(viewport.top / viewport.rowHeight) - 8), Math.max(0, rows.length - 1))
    : 0;
  const last = virtual
    ? Math.min(rows.length, first + Math.ceil(viewport.height / viewport.rowHeight) + 20)
    : rows.length;
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () =>
      setViewport((current) => ({
        ...current,
        height: element.clientHeight || 700,
        rowHeight: element.querySelector("tr[data-roster-index]")?.getBoundingClientRect().height || current.rowHeight,
      }));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [virtual]);
  useEffect(() => {
    if (!viewportRef.current) return;
    viewportRef.current.scrollTop = 0;
    setViewport((current) => ({ ...current, top: 0 }));
  }, [grid.filters, grid.sort]);
  function focusRow(index: number) {
    const element = viewportRef.current;
    if (!element || index < 0 || index >= rows.length) return;
    const top = index * viewport.rowHeight;
    if (top < element.scrollTop || top + viewport.rowHeight > element.scrollTop + element.clientHeight - 60) {
      element.scrollTop = Math.max(0, top - element.clientHeight / 2);
      setViewport((current) => ({ ...current, top: element.scrollTop }));
    }
    requestAnimationFrame(() =>
      element.querySelector<HTMLElement>(`tr[data-roster-index="${index}"]`)?.focus({ preventScroll: true }),
    );
  }
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
              <label className="operator-label-copies" title={state.labelTemplateName}>
                <span>출력 매수</span>
                <input
                  type="number"
                  aria-label="라벨 출력 매수"
                  min={1}
                  max={10}
                  step={1}
                  value={state.labelCopies}
                  disabled={state.printing}
                  aria-invalid={!state.labelCopiesValid}
                  title="1~10매"
                  onChange={(event) =>
                    actions.setLabelCopies(event.target.value === "" ? "" : Number(event.target.value))
                  }
                />
              </label>
              <OperationPrinterStatus
                diagnostic={state.printerDiagnostic}
                busy={state.printerDiagnosticBusy}
                printing={state.printing}
                onRecheck={actions.recheckPrinter}
              />
              <button
                className="operator-roster-label-button"
                onClick={actions.printLabel}
                disabled={
                  !state.assignment ||
                  state.printing ||
                  state.deletingHistory ||
                  !printerReady ||
                  !state.labelCopiesValid ||
                  state.labelAlreadyPrinted
                }
                title={
                  state.labelAlreadyPrinted
                    ? "이미 출력된 수험생은 라벨을 재출력할 수 없습니다."
                    : printerReady
                      ? "선택한 수험생의 라벨 출력"
                      : state.printerDiagnostic.message
                }
              >
                <OperatorPrintIcon />
                {state.printing ? "전송 중…" : "라벨 출력"}
              </button>
            </>
          )}
          <button
            className={`operator-operation-close-button ${state.operationClosed ? "closed" : ""}`}
            onClick={actions.openCloseConfirm}
            disabled={!state.operationStatusLoaded || state.closingOperation || state.deletingHistory}
            title={state.operationClosed ? "마감 취소" : "운영 마감"}
          >
            <OperatorFinishIcon />
            {state.operationClosed ? "마감 취소" : "운영 마감"}
          </button>
          <button
            className="operator-template-print-button"
            onClick={actions.openPrint}
            disabled={!state.operationStatusLoaded || !state.operationClosed}
            title={state.operationClosed ? "인쇄 양식 선택" : "운영 마감 후 사용할 수 있습니다."}
          >
            <OperatorPrintIcon />
            인쇄
          </button>
          <button
            className="operator-refresh-button"
            onClick={actions.refresh}
            disabled={state.rosterRefreshing || state.deletingHistory}
            aria-label="새로고침"
            aria-busy={state.rosterRefreshing}
            title={state.rosterRefreshing ? "갱신 중…" : "가번호 등록 현황 새로고침"}
          >
            <RefreshButtonIcon />
          </button>
          <button
            type="button"
            className="operator-delete-button"
            onClick={actions.deleteHistory}
            disabled={!state.canDeleteHistory || state.deletingHistory}
            aria-label="삭제"
            aria-busy={state.deletingHistory}
            title={state.labelPrintingEnabled ? "선택한 수험생의 라벨 출력이력 삭제" : "선택한 수험생의 가번호 삭제"}
          >
            <DeleteButtonIcon />
          </button>
          <button
            className="operator-download-button"
            onClick={actions.download}
            disabled={state.exportingExcel}
            aria-label="다운로드"
            aria-busy={state.exportingExcel}
            title={state.exportingExcel ? "생성 중…" : "현재 그리드 엑셀 다운로드"}
          >
            <OperatorDownloadIcon />
          </button>
        </div>
      </header>
      <div
        className="operator-roster-table-wrap"
        ref={viewportRef}
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop;
          setViewport((current) => ({ ...current, top }));
        }}
      >
        <table
          aria-rowcount={rows.length + 1}
          style={virtual ? { height: "auto" } : undefined}
          className={`candidate-data-table operator-roster-table ${rows.length ? "" : "is-empty"}`}
        >
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
            {first > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={columns.length + 1}
                  style={{ height: first * viewport.rowHeight, padding: 0, border: 0 }}
                />
              </tr>
            )}
            {rows.length ? (
              rows.slice(first, last).map((row, index) => (
                <tr
                  key={row.candidate.examineeNo}
                  data-roster-index={first + index}
                  aria-rowindex={first + index + 2}
                  className={selectedExamineeNo === row.candidate.examineeNo ? "is-selected" : ""}
                  tabIndex={0}
                  aria-label={`${row.candidate.examineeNo} ${row.candidate.name} 조회`}
                  onClick={() => actions.select(row.candidate.examineeNo)}
                  onKeyDown={(event) => {
                    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                      event.preventDefault();
                      focusRow(
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? rows.length - 1
                            : first + index + (event.key === "ArrowDown" ? 1 : -1),
                      );
                    }
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      actions.select(row.candidate.examineeNo);
                    }
                  }}
                >
                  <td className="candidate-row-number">{first + index + 1}</td>
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
            {last < rows.length && (
              <tr aria-hidden="true">
                <td
                  colSpan={columns.length + 1}
                  style={{ height: (rows.length - last) * viewport.rowHeight, padding: 0, border: 0 }}
                />
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
