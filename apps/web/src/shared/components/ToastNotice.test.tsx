// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastNotice } from "./ToastNotice";

describe("ToastNotice", () => {
  it("announces errors assertively and closes from its labelled button", () => {
    const onClose = vi.fn();
    render(<ToastNotice notice={{ kind: "error", text: "저장하지 못했습니다." }} onClose={onClose} />);

    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    expect(screen.getByText("저장하지 못했습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "알림 닫기" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("announces successful work politely", () => {
    render(<ToastNotice notice={{ kind: "success", text: "저장되었습니다." }} onClose={() => undefined} />);

    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });
});
