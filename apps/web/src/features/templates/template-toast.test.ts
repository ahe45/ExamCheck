// @vitest-environment jsdom

import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hideToast, showToast } from "examlist-template-editor/examlist/app/toast";

describe("template editor toast", () => {
  afterEach(() => {
    hideToast();
    vi.useRealTimers();
  });

  it("pauses and restores a fading toast when hovered", () => {
    vi.useFakeTimers();
    showToast("개체를 선택해 주세요.", "warning");
    const toast = document.querySelector<HTMLElement>(".toast-message")!;

    vi.advanceTimersByTime(3_000);
    expect(toast).toHaveClass("is-fading");
    fireEvent.mouseEnter(toast);
    expect(toast).not.toHaveClass("is-fading");
    vi.advanceTimersByTime(1_000);
    expect(document.body.contains(toast)).toBe(true);
    fireEvent.mouseLeave(toast);
    vi.advanceTimersByTime(3_320);
    expect(document.querySelector(".toast-message")).toBeNull();
  });
});
