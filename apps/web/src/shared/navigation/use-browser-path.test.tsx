// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useBrowserPath } from "./use-browser-path";

function PathHarness() {
  const { pathname, navigate } = useBrowserPath();
  return (
    <div>
      <output>{pathname}</output>
      <button onClick={() => navigate("/next")}>push</button>
      <button onClick={() => navigate("/replacement", { replace: true })}>replace</button>
    </div>
  );
}

describe("useBrowserPath", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/start");
  });

  it("push와 replace 탐색 직후 현재 경로를 동기화한다", () => {
    render(<PathHarness />);
    fireEvent.click(screen.getByRole("button", { name: "push" }));
    expect(screen.getByText("/next")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "replace" }));
    expect(screen.getByText("/replacement")).toBeInTheDocument();
  });

  it("브라우저 popstate 탐색을 화면 상태에 반영한다", () => {
    render(<PathHarness />);
    act(() => {
      window.history.replaceState({}, "", "/history");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByText("/history")).toBeInTheDocument();
  });
});
