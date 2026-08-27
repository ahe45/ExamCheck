// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";

function BrokenView(): never {
  throw new Error("sensitive rendering detail");
}

describe("AppErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("shows a stable recovery view without exposing the raw error", () => {
    const onReset = vi.fn();
    render(
      <AppErrorBoundary onReset={onReset}>
        <BrokenView />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("화면을 표시하지 못했습니다.");
    expect(screen.queryByText("sensitive rendering detail")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "화면 새로고침" }));
    expect(onReset).toHaveBeenCalledOnce();
  });
});
