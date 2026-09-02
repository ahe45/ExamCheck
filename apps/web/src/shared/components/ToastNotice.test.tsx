// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastNotice } from "./ToastNotice";

describe("ToastNotice", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("starts fading after three seconds and closes after the fade", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<ToastNotice notice={{ kind: "success", text: "저장되었습니다." }} onClose={onClose} />);
    const toast = screen.getByRole("status");

    act(() => vi.advanceTimersByTime(2_999));
    expect(toast).not.toHaveClass("is-fading");
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(toast).toHaveClass("is-fading");
    act(() => vi.advanceTimersByTime(320));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("pauses while hovered and resumes with the remaining time", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<ToastNotice notice={{ kind: "success", text: "저장되었습니다." }} onClose={onClose} />);
    const toast = screen.getByRole("status");

    act(() => vi.advanceTimersByTime(2_000));
    fireEvent.mouseEnter(toast);
    act(() => vi.advanceTimersByTime(5_000));
    expect(toast).not.toHaveClass("is-fading");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseLeave(toast);
    act(() => vi.advanceTimersByTime(1_000));
    expect(toast).toHaveClass("is-fading");
  });

  it("cancels an active fade when hovered and keeps the toast visible", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<ToastNotice notice={{ kind: "error", text: "확인이 필요합니다." }} onClose={onClose} />);
    const toast = screen.getByRole("alert");

    act(() => vi.advanceTimersByTime(3_000));
    expect(toast).toHaveClass("is-fading");
    fireEvent.mouseEnter(toast);
    expect(toast).not.toHaveClass("is-fading");
    act(() => vi.advanceTimersByTime(2_000));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseLeave(toast);
    act(() => vi.advanceTimersByTime(3_000));
    expect(toast).toHaveClass("is-fading");
  });
});
