interface GridSortIndicatorProps {
  direction: "asc" | "desc";
}

export function GridSortIndicator({ direction }: GridSortIndicatorProps) {
  return (
    <svg className="candidate-sort-indicator" viewBox="0 0 16 16" aria-hidden="true">
      {direction === "asc" ? <path d="M8 13V3M4.5 6.5 8 3l3.5 3.5" /> : <path d="M8 3v10m-3.5-3.5L8 13l3.5-3.5" />}
    </svg>
  );
}

export function GridFilterIcon() {
  return (
    <svg className="candidate-filter-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 3.5h10L9.2 7.9v3.3l-2.4 1.3V7.9L3 3.5Z" />
    </svg>
  );
}
