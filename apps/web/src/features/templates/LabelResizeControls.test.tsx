// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import type { LabelTemplateElement, LabelTemplateLayout } from "../../shared/api/label-templates";
import { LabelResizeControls } from "./LabelResizeControls";

const element: LabelTemplateElement = {
  id: "tag",
  kind: "text",
  xMm: 20,
  yMm: 20,
  widthMm: 20,
  heightMm: 10,
  fontSizeMm: 10,
};
const layout: LabelTemplateLayout = { widthMm: 100, heightMm: 80, dpi: 203, elements: [element] };

describe("LabelResizeControls", () => {
  beforeEach(() => {
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    vi.stubGlobal("PointerEvent", TestPointerEvent);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setup() {
    const onResize = vi.fn();
    const paperPointerDown = vi.fn();
    const canvasRef = createRef<HTMLDivElement>();
    render(
      <div ref={canvasRef} onPointerDown={paperPointerDown} tabIndex={0}>
        <LabelResizeControls element={element} layout={layout} canvasRef={canvasRef} onResize={onResize} />
      </div>,
    );
    vi.spyOn(canvasRef.current!, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      toJSON: () => ({}),
    });
    const handle = screen.getByRole("button", { name: "오른쪽 아래 크기 조절" });
    let captured = false;
    handle.setPointerCapture = vi.fn(() => {
      captured = true;
    });
    handle.hasPointerCapture = vi.fn(() => captured);
    handle.releasePointerCapture = vi.fn(() => {
      captured = false;
    });
    return { handle, onResize, paperPointerDown };
  }
  it("shows eight handles and converts pointer travel using the actual canvas scale", () => {
    const { handle, onResize, paperPointerDown } = setup();
    expect(screen.getAllByRole("button", { name: /크기 조절$/ })).toHaveLength(8);
    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 150, pointerId: 1 });
    expect(onResize.mock.lastCall?.[0]?.[0]).toMatchObject({
      xMm: 20,
      yMm: 20,
      widthMm: 30,
      heightMm: 15,
      fontSizeMm: 15,
    });
    expect(paperPointerDown).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 350, clientY: 150, pointerId: 1 });
    expect(onResize).toHaveBeenCalledTimes(1);
  });
  it("toggles proportional resizing during a drag and can return to the starting size", () => {
    const { handle, onResize } = setup();
    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 100, pointerId: 1, shiftKey: true });
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 100, pointerId: 1, shiftKey: true });
    expect(onResize.mock.lastCall?.[0]?.[0]).toMatchObject({ widthMm: 30, heightMm: 15 });
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 100, pointerId: 1, shiftKey: false });
    expect(onResize.mock.lastCall?.[0]?.[0]).toMatchObject({ widthMm: 30, heightMm: 10 });
    fireEvent.pointerMove(handle, { clientX: 200, clientY: 100, pointerId: 1 });
    expect(onResize.mock.lastCall?.[0]?.[0]).toMatchObject({ widthMm: 20, heightMm: 10 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 400, clientY: 100, pointerId: 1 });
    expect(onResize).toHaveBeenCalledTimes(3);
  });
  it("does not resize on a click, small jitter, or another pointer", () => {
    const { handle, onResize } = setup();
    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 201, clientY: 101, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 150, pointerId: 2 });
    expect(onResize).not.toHaveBeenCalled();
  });
});
