// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePrinterConnectionCheck } from "./usePrinterConnectionCheck";

describe("usePrinterConnectionCheck", () => {
  it("checks once when preassigned label printing becomes enabled and again for a new schedule", () => {
    const diagnose = vi.fn(async () => undefined);
    const { rerender } = renderHook(
      ({ enabled, scopeKey }) => usePrinterConnectionCheck(enabled, scopeKey, diagnose),
      { initialProps: { enabled: false, scopeKey: "schedule-a" } },
    );

    expect(diagnose).not.toHaveBeenCalled();
    rerender({ enabled: true, scopeKey: "schedule-a" });
    expect(diagnose).toHaveBeenCalledTimes(1);
    rerender({ enabled: true, scopeKey: "schedule-a" });
    expect(diagnose).toHaveBeenCalledTimes(1);
    rerender({ enabled: true, scopeKey: "schedule-b" });
    expect(diagnose).toHaveBeenCalledTimes(2);
  });
});
