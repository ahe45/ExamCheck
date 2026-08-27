// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getClientGridColumnState, type GridFilters, type GridSort } from "../hooks/useClientDataGrid";
import { ClientGridHeaderCell } from "./ClientGridHeaderCell";

type ColumnKey = "name" | "group";

function HeaderHarness({
  sort,
  filters,
  onSort = vi.fn(),
  onOpenFilter = vi.fn(),
}: {
  sort: GridSort<ColumnKey> | null;
  filters: GridFilters<ColumnKey>;
  onSort?(key: ColumnKey): void;
  onOpenFilter?: React.ComponentProps<typeof ClientGridHeaderCell<ColumnKey>>["onOpenFilter"];
}) {
  return (
    <table>
      <thead>
        <tr>
          <ClientGridHeaderCell
            columnKey="name"
            label="성명"
            className="candidate-wide-column"
            sort={sort}
            filters={filters}
            onSort={onSort}
            onOpenFilter={onOpenFilter}
          />
        </tr>
      </thead>
    </table>
  );
}

describe("ClientGridHeaderCell", () => {
  it("현재 컬럼에 실제 적용된 정렬과 필터만 활성 상태로 판정한다", () => {
    expect(getClientGridColumnState<ColumnKey>({ key: "group", direction: "asc" }, { name: [] }, "name")).toEqual({
      sortDirection: null,
      filtered: false,
    });
    expect(getClientGridColumnState<ColumnKey>({ key: "name", direction: "desc" }, { name: ["김가"] }, "name")).toEqual(
      { sortDirection: "desc", filtered: true },
    );
  });

  it("정렬 아이콘과 필터 UI를 실제 적용 상태에 맞춰 표시한다", () => {
    const view = render(<HeaderHarness sort={null} filters={{ name: [] }} />);
    const filterButton = screen.getByRole("button", { name: "성명 필터" });

    expect(view.container.querySelector(".candidate-sort-indicator")).not.toBeInTheDocument();
    expect(filterButton).toHaveAttribute("aria-pressed", "false");
    expect(filterButton).not.toHaveClass("active");
    expect(filterButton.closest("th")).not.toHaveClass("filtered");

    view.rerender(<HeaderHarness sort={{ key: "name", direction: "asc" }} filters={{ name: ["김가"] }} />);

    expect(view.container.querySelector(".candidate-sort-indicator")).toBeInTheDocument();
    expect(filterButton).toHaveAttribute("aria-pressed", "true");
    expect(filterButton).toHaveClass("active");
    expect(filterButton.closest("th")).toHaveClass("candidate-wide-column", "filtered");
  });

  it("화면별 콜백에 컬럼 키를 그대로 전달한다", () => {
    const onSort = vi.fn();
    const onOpenFilter = vi.fn();
    render(<HeaderHarness sort={null} filters={{}} onSort={onSort} onOpenFilter={onOpenFilter} />);

    fireEvent.click(screen.getByRole("button", { name: "성명" }));
    fireEvent.click(screen.getByRole("button", { name: "성명 필터" }));

    expect(onSort).toHaveBeenCalledWith("name");
    expect(onOpenFilter).toHaveBeenCalledWith(expect.any(Object), "name");
  });
});
