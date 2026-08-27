import { ConfirmButtonIcon, ResetButtonIcon } from "./ActionIcons";
import type { GridFilterMenu } from "../hooks/useClientDataGrid";

const clientGridPageSizes = [10, 30, 50, 100, 500, 1000, 2000, 0] as const;

interface ClientGridFilterMenuProps {
  label: string;
  x: number;
  y: number;
  search: string;
  draft: string[];
  options: string[];
  onSearch(value: string): void;
  onToggleOption(value: string, checked: boolean): void;
  onToggleVisible(checked: boolean): void;
  onClose(): void;
  onReset(): void;
  onApply(): void;
}

export function ClientGridFilterMenu({
  label,
  x,
  y,
  search,
  draft,
  options,
  onSearch,
  onToggleOption,
  onToggleVisible,
  onClose,
  onReset,
  onApply,
}: ClientGridFilterMenuProps) {
  const allVisibleSelected = options.length > 0 && options.every((value) => draft.includes(value));

  return (
    <div className="candidate-filter-menu" style={{ left: x, top: y }} role="dialog" aria-label={`${label} 필터`}>
      <div className="candidate-filter-title">
        <strong>{label}</strong>
        <button onClick={onClose} aria-label="필터 닫기">
          ×
        </button>
      </div>
      <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="필터 값 검색" autoFocus />
      <label className="candidate-filter-all">
        <input
          type="checkbox"
          checked={allVisibleSelected}
          onChange={(event) => onToggleVisible(event.target.checked)}
        />
        전체 선택
      </label>
      <div className="candidate-filter-options">
        {options.map((value) => (
          <label key={value || "__blank"}>
            <input
              type="checkbox"
              checked={draft.includes(value)}
              onChange={(event) => onToggleOption(value, event.target.checked)}
            />
            <span>{value || "(빈 값)"}</span>
          </label>
        ))}
      </div>
      <footer>
        <button onClick={onReset}>
          <ResetButtonIcon />
          <span>초기화</span>
        </button>
        <button className="primary" onClick={onApply}>
          <ConfirmButtonIcon />
          <span>적용</span>
        </button>
      </footer>
    </div>
  );
}

interface ClientGridFilterLayerProps<K extends string> extends Omit<ClientGridFilterMenuProps, "label" | "x" | "y"> {
  columns: readonly { key: K; label: string }[];
  menu: GridFilterMenu<K> | null;
}

export function ClientGridFilterLayer<K extends string>({
  columns,
  menu,
  ...menuProps
}: ClientGridFilterLayerProps<K>) {
  if (!menu) return null;
  const column = columns.find((item) => item.key === menu.key);
  if (!column) return null;
  return <ClientGridFilterMenu {...menuProps} label={column.label} x={menu.x} y={menu.y} />;
}

interface ClientGridPaginationProps {
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
  start: number;
  end: number;
  onPage(value: number): void;
  onPageSize(value: number): void;
}

export function ClientGridPagination({
  count,
  page,
  pageSize,
  totalPages,
  start,
  end,
  onPage,
  onPageSize,
}: ClientGridPaginationProps) {
  const pageNumbers = Array.from(
    new Set([1, page - 1, page, page + 1, totalPages].filter((value) => value >= 1 && value <= totalPages)),
  ).sort((left, right) => left - right);

  return (
    <footer className="candidate-pagination">
      <label>
        표시 개수
        <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
          {clientGridPageSizes.map((size) => (
            <option key={size} value={size}>
              {size ? `${size}개` : "모두 표시"}
            </option>
          ))}
        </select>
      </label>
      <nav aria-label="페이지네이션">
        <button onClick={() => onPage(page - 1)} disabled={page <= 1}>
          이전
        </button>
        {pageNumbers.map((number, index) => (
          <span key={number}>
            {index > 0 && number - pageNumbers[index - 1] > 1 && <i>…</i>}
            <button
              className={number === page ? "active" : ""}
              aria-current={number === page ? "page" : undefined}
              onClick={() => onPage(number)}
            >
              {number}
            </button>
          </span>
        ))}
        <button onClick={() => onPage(page + 1)} disabled={page >= totalPages}>
          다음
        </button>
        <select aria-label="페이지 이동" value={page} onChange={(event) => onPage(Number(event.target.value))}>
          {Array.from({ length: totalPages }, (_, index) => (
            <option key={index + 1} value={index + 1}>
              {index + 1}
            </option>
          ))}
        </select>
        <small>page</small>
      </nav>
      <p>
        {start.toLocaleString()}-{end.toLocaleString()} / 총 {count.toLocaleString()}건
      </p>
    </footer>
  );
}
