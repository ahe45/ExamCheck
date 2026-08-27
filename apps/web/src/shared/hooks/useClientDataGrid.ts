import { useEffect, useMemo, useState, type MouseEvent } from "react";

export type GridSort<K extends string> = {
  key: K;
  direction: "asc" | "desc";
};

export type GridFilterMenu<K extends string> = {
  key: K;
  x: number;
  y: number;
};

export type GridFilters<K extends string> = Partial<Record<K, string[]>>;

export function getClientGridColumnState<K extends string>(sort: GridSort<K> | null, filters: GridFilters<K>, key: K) {
  return {
    sortDirection: sort?.key === key ? sort.direction : null,
    filtered: Boolean(filters[key]?.length),
  } as const;
}

interface UseClientDataGridOptions<T, K extends string> {
  rows: T[];
  valueOf(row: T, key: K): string;
  initialPageSize?: number;
  resetKey?: string;
}

export function useClientDataGrid<T, K extends string>({
  rows,
  valueOf,
  initialPageSize = 30,
  resetKey,
}: UseClientDataGridOptions<T, K>) {
  const [sort, setSort] = useState<GridSort<K> | null>(null);
  const [filters, setFilters] = useState<GridFilters<K>>({});
  const [filterMenu, setFilterMenu] = useState<GridFilterMenu<K> | null>(null);
  const [filterSearch, setFilterSearch] = useState("");
  const [filterDraft, setFilterDraft] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  const filteredRows = useMemo(() => {
    const nextRows = rows.filter((row) =>
      (Object.entries(filters) as Array<[K, string[]]>).every(
        ([key, selected]) => !selected.length || selected.includes(valueOf(row, key)),
      ),
    );

    if (!sort) return nextRows;

    const multiplier = sort.direction === "desc" ? -1 : 1;
    return [...nextRows].sort(
      (left, right) =>
        valueOf(left, sort.key).localeCompare(valueOf(right, sort.key), "ko", {
          numeric: true,
          sensitivity: "base",
        }) * multiplier,
    );
  }, [filters, rows, sort, valueOf]);

  const totalPages = pageSize ? Math.max(1, Math.ceil(filteredRows.length / pageSize)) : 1;
  const currentPage = Math.min(page, totalPages);
  const startIndex = pageSize ? (currentPage - 1) * pageSize : 0;
  const visibleRows = pageSize ? filteredRows.slice(startIndex, startIndex + pageSize) : filteredRows;

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (resetKey === undefined) return;
    setSort(null);
    setFilters({});
    setFilterMenu(null);
    setFilterSearch("");
    setFilterDraft([]);
    setPage(1);
  }, [resetKey]);

  const filterValues = useMemo(() => {
    if (!filterMenu) return [];
    return Array.from(new Set(rows.map((row) => valueOf(row, filterMenu.key)))).sort((left, right) =>
      left.localeCompare(right, "ko", { numeric: true }),
    );
  }, [filterMenu, rows, valueOf]);

  const filterOptions = useMemo(() => {
    const searchText = filterSearch.trim().toLocaleLowerCase("ko");
    return searchText
      ? filterValues.filter((value) => value.toLocaleLowerCase("ko").includes(searchText))
      : filterValues;
  }, [filterSearch, filterValues]);

  function cycleSort(key: K) {
    setSort((current) =>
      current?.key !== key
        ? { key, direction: "asc" }
        : current.direction === "asc"
          ? { key, direction: "desc" }
          : null,
    );
    setPage(1);
  }

  function openFilter(event: MouseEvent<HTMLButtonElement>, key: K) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const allValues = Array.from(new Set(rows.map((row) => valueOf(row, key))));
    const appliedValues = filters[key] ?? [];
    setFilterMenu({
      key,
      x: Math.max(12, Math.min(rect.left, window.innerWidth - 282)),
      y: rect.bottom + 6,
    });
    setFilterSearch("");
    setFilterDraft(appliedValues.length ? [...appliedValues] : allValues);
  }

  function closeFilter() {
    setFilterMenu(null);
    setFilterSearch("");
    setFilterDraft([]);
  }

  function toggleFilterOption(value: string, checked: boolean) {
    setFilterDraft((current) =>
      checked ? (current.includes(value) ? current : [...current, value]) : current.filter((item) => item !== value),
    );
  }

  function toggleVisibleFilterOptions(checked: boolean) {
    setFilterDraft((current) =>
      checked
        ? Array.from(new Set([...current, ...filterOptions]))
        : current.filter((value) => !filterOptions.includes(value)),
    );
  }

  function resetFilter() {
    if (!filterMenu) return;
    setFilters((current) => ({ ...current, [filterMenu.key]: [] }));
    setPage(1);
    closeFilter();
  }

  function applyFilter() {
    if (!filterMenu) return;
    const allSelected = filterValues.length > 0 && filterValues.every((value) => filterDraft.includes(value));
    setFilters((current) => ({
      ...current,
      [filterMenu.key]: allSelected ? [] : [...filterDraft],
    }));
    setPage(1);
    closeFilter();
  }

  function setPageSize(value: number) {
    setPageSizeState(value);
    setPage(1);
  }

  return {
    sort,
    filters,
    filterMenu,
    filterSearch,
    filterDraft,
    filterOptions,
    filteredRows,
    visibleRows,
    currentPage,
    pageSize,
    totalPages,
    startIndex,
    setFilterSearch,
    setPage,
    setPageSize,
    cycleSort,
    openFilter,
    closeFilter,
    toggleFilterOption,
    toggleVisibleFilterOptions,
    resetFilter,
    applyFilter,
    isFiltered: (key: K) => getClientGridColumnState(sort, filters, key).filtered,
  };
}
