// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClientGridFilterLayer } from "./ClientDataGridControls";

const callbacks = {
  onSearch: vi.fn(),
  onToggleOption: vi.fn(),
  onToggleVisible: vi.fn(),
  onClose: vi.fn(),
  onReset: vi.fn(),
  onApply: vi.fn(),
};

describe("ClientGridFilterLayer", () => {
  it("열린 컬럼의 라벨과 위치로 공통 필터 메뉴를 연결한다", () => {
    render(
      <ClientGridFilterLayer
        columns={[
          { key: "name", label: "성명" },
          { key: "group", label: "전형" },
        ]}
        menu={{ key: "group", x: 24, y: 36 }}
        search=""
        draft={["면접"]}
        options={["면접"]}
        {...callbacks}
      />,
    );

    const menu = screen.getByRole("dialog", { name: "전형 필터" });
    expect(menu).toHaveStyle({ left: "24px", top: "36px" });
    expect(screen.getByRole("checkbox", { name: "전체 선택" })).toBeChecked();
  });

  it("메뉴가 없거나 컬럼 정의와 일치하지 않으면 필터 UI를 표시하지 않는다", () => {
    const view = render(
      <ClientGridFilterLayer
        columns={[{ key: "name", label: "성명" }]}
        menu={null}
        search=""
        draft={[]}
        options={[]}
        {...callbacks}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    view.rerender(
      <ClientGridFilterLayer
        columns={[{ key: "name", label: "성명" }]}
        menu={{ key: "group" as "name", x: 0, y: 0 }}
        search=""
        draft={[]}
        options={[]}
        {...callbacks}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
