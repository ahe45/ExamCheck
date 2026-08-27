// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClientGridHeaderCell } from "../components/ClientGridHeaderCell";
import { useClientDataGrid } from "./useClientDataGrid";

interface Row {
  id: string;
  group: string;
}

const rows: Row[] = [
  { id: "10", group: "B" },
  { id: "2", group: "A" },
  { id: "1", group: "A" },
];

function valueOf(row: Row, key: keyof Row) {
  return row[key];
}

function GridHarness({ resetKey }: { resetKey?: string }) {
  const grid = useClientDataGrid<Row, keyof Row>({ rows, valueOf, initialPageSize: 2, resetKey });

  return (
    <div>
      <output aria-label="rows">{grid.visibleRows.map((row) => row.id).join(",")}</output>
      <output aria-label="filtered">{String(grid.isFiltered("group"))}</output>
      <button onClick={() => grid.cycleSort("id")}>sort</button>
      <button onClick={(event) => grid.openFilter(event, "group")}>filter</button>
      <button onClick={() => grid.toggleFilterOption("B", false)}>remove-b</button>
      <button onClick={grid.applyFilter}>apply</button>
      <button onClick={grid.resetFilter}>reset</button>
      <button onClick={() => grid.setPage(2)}>page-2</button>
      <table>
        <thead>
          <tr>
            <ClientGridHeaderCell
              columnKey="group"
              label="그룹"
              sort={grid.sort}
              filters={grid.filters}
              onSort={grid.cycleSort}
              onOpenFilter={grid.openFilter}
            />
          </tr>
        </thead>
      </table>
    </div>
  );
}

describe("useClientDataGrid", () => {
  it("숫자가 포함된 값을 오름차순·내림차순·기본 순서로 순환 정렬한다", () => {
    render(<GridHarness />);
    expect(screen.getByLabelText("rows")).toHaveTextContent("10,2");

    fireEvent.click(screen.getByRole("button", { name: "sort" }));
    expect(screen.getByLabelText("rows")).toHaveTextContent("1,2");

    fireEvent.click(screen.getByRole("button", { name: "sort" }));
    expect(screen.getByLabelText("rows")).toHaveTextContent("10,2");

    fireEvent.click(screen.getByRole("button", { name: "sort" }));
    expect(screen.getByLabelText("rows")).toHaveTextContent("10,2");
  });

  it("전체 선택은 필터 없음으로 저장하고 일부 선택만 활성 필터로 표시한다", () => {
    render(<GridHarness />);
    fireEvent.click(screen.getByRole("button", { name: "filter" }));
    fireEvent.click(screen.getByRole("button", { name: "apply" }));
    expect(screen.getByLabelText("filtered")).toHaveTextContent("false");
    expect(screen.getByRole("button", { name: "그룹 필터" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "filter" }));
    fireEvent.click(screen.getByRole("button", { name: "remove-b" }));
    fireEvent.click(screen.getByRole("button", { name: "apply" }));
    expect(screen.getByLabelText("filtered")).toHaveTextContent("true");
    expect(screen.getByRole("button", { name: "그룹 필터" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("rows")).toHaveTextContent("2,1");
  });

  it("페이지 크기 기준으로 데이터를 나누고 페이지를 이동한다", () => {
    render(<GridHarness />);
    fireEvent.click(screen.getByRole("button", { name: "page-2" }));
    expect(screen.getByLabelText("rows")).toHaveTextContent("1");
  });

  it("데이터 범위 키가 바뀌면 이전 정렬·필터·페이지 상태를 초기화한다", () => {
    const { rerender } = render(<GridHarness resetKey="오전" />);
    fireEvent.click(screen.getByRole("button", { name: "filter" }));
    fireEvent.click(screen.getByRole("button", { name: "remove-b" }));
    fireEvent.click(screen.getByRole("button", { name: "apply" }));
    fireEvent.click(screen.getByRole("button", { name: "sort" }));
    fireEvent.click(screen.getByRole("button", { name: "page-2" }));
    expect(screen.getByLabelText("filtered")).toHaveTextContent("true");

    rerender(<GridHarness resetKey="오후" />);

    expect(screen.getByLabelText("filtered")).toHaveTextContent("false");
    expect(screen.getByLabelText("rows")).toHaveTextContent("10,2");
  });
});
