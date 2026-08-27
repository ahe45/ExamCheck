import type { MouseEvent } from "react";
import { getClientGridColumnState, type GridFilters, type GridSort } from "../hooks/useClientDataGrid";
import { GridFilterIcon, GridSortIndicator } from "./GridHeaderIcons";

interface ClientGridHeaderCellProps<K extends string> {
  columnKey: K;
  label: string;
  className?: string;
  sort: GridSort<K> | null;
  filters: GridFilters<K>;
  onSort(key: K): void;
  onOpenFilter(event: MouseEvent<HTMLButtonElement>, key: K): void;
}

export function ClientGridHeaderCell<K extends string>({
  columnKey,
  label,
  className = "",
  sort,
  filters,
  onSort,
  onOpenFilter,
}: ClientGridHeaderCellProps<K>) {
  const state = getClientGridColumnState(sort, filters, columnKey);
  const headerClassName = [className, state.filtered ? "filtered" : ""].filter(Boolean).join(" ");

  return (
    <th className={headerClassName}>
      <button className="candidate-sort-button" onClick={() => onSort(columnKey)}>
        <span>{label}</span>
        {state.sortDirection && <GridSortIndicator direction={state.sortDirection} />}
      </button>
      <button
        className={`candidate-filter-button ${state.filtered ? "active" : ""}`}
        aria-label={`${label} 필터`}
        aria-pressed={state.filtered}
        onClick={(event) => onOpenFilter(event, columnKey)}
      >
        <GridFilterIcon />
      </button>
    </th>
  );
}
