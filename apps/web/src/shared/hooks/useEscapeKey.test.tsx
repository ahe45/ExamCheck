// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useEscapeKey } from "./useEscapeKey";

function EscapeLayer({ active, onEscape }: { active: boolean; onEscape(): void }) {
  useEscapeKey(active, onEscape);
  return null;
}

function NestedLayers({ onOuter, onInner }: { onOuter(): void; onInner(): void }) {
  const [innerActive, setInnerActive] = useState(true);
  useEscapeKey(true, onOuter);
  useEscapeKey(innerActive, () => {
    onInner();
    setInnerActive(false);
  });
  return <output>{innerActive ? "inner" : "outer"}</output>;
}

describe("useEscapeKey", () => {
  it("비활성 상태에서는 ESC를 처리하지 않는다", () => {
    const onEscape = vi.fn();
    render(<EscapeLayer active={false} onEscape={onEscape} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("중첩된 오버레이 중 최상위 항목만 닫는다", () => {
    const onOuter = vi.fn();
    const onInner = vi.fn();
    render(<NestedLayers onOuter={onOuter} onInner={onInner} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onInner).toHaveBeenCalledTimes(1);
    expect(onOuter).not.toHaveBeenCalled();
    expect(screen.getByText("outer")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOuter).toHaveBeenCalledTimes(1);
  });
});
