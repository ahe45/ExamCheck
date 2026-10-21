// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { createPortal } from "react-dom";
import type { Examinee } from "../../shared/api/examinees";
import { OperationCandidateDisplay } from "./OperationCandidateDisplay";
import { afterEach, expect, it, vi } from "vitest";
import { useCandidateDisplayWindow } from "./useCandidateDisplayWindow";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("reuses the display window, detects closure, reopens and closes it on leaving the operator page", () => {
  vi.useFakeTimers();
  const popup = {
    document: document.implementation.createHTMLDocument(),
    closed: false,
    focus: vi.fn(),
    close: vi.fn(),
  };
  const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  const blocked = vi.fn();
  const { result, unmount } = renderHook(() => useCandidateDisplayWindow(blocked));
  act(() => result.current.open());
  expect(result.current.container?.ownerDocument).toBe(popup.document);
  act(() => result.current.open());
  expect(open).toHaveBeenCalledTimes(1);
  expect(popup.focus).toHaveBeenCalledOnce();
  popup.closed = true;
  act(() => vi.advanceTimersByTime(500));
  expect(result.current.container).toBeNull();
  popup.closed = false;
  act(() => result.current.open());
  expect(open).toHaveBeenCalledTimes(2);
  unmount();
  expect(popup.close).toHaveBeenCalledOnce();
  expect(blocked).not.toHaveBeenCalled();
});

it("reports blocked popups without interrupting the operator page", () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  const blocked = vi.fn();
  const { result } = renderHook(() => useCandidateDisplayWindow(blocked));
  act(() => result.current.open());
  expect(blocked).toHaveBeenCalledOnce();
  expect(result.current.container).toBeNull();
});

it("keeps candidate information and matching values in the second document synchronized with operator state", () => {
  const popup = { document: document.implementation.createHTMLDocument(), closed: false, close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  const blocked = vi.fn();
  function Operator({ name, number }: { name: string; number: string }) {
    const display = useCandidateDisplayWindow(blocked);
    return (
      <>
        <button onClick={display.open}>창 분리</button>
        {display.container &&
          createPortal(
            <OperationCandidateDisplay
              candidate={{ name, examineeNo: "001" } as Examinee}
              assignment={null}
              selectedMode="MANUAL"
              useCandidatePhotos={false}
              photoUrl={null}
              drawOpen={Boolean(number)}
              drawProps={{
                position: { left: 0, top: 0 },
                matching: true,
                manualNumber: number,
                assignment: null,
                previewNumber: 0,
                autoDrawEnabled: false,
                remainingMs: 0,
                delaySeconds: 3,
                canAssign: true,
                assigning: false,
                onAssign: vi.fn(),
                onClose: vi.fn(),
              }}
            />,
            display.container,
          )}
      </>
    );
  }
  const { rerender } = render(<Operator name="홍길동" number="0017" />);
  fireEvent.click(screen.getByRole("button", { name: "창 분리" }));
  const audience = within(popup.document.body);
  expect(audience.getByText("홍길동").isConnected).toBe(true);
  expect(audience.getByText("0017").isConnected).toBe(true);
  rerender(<Operator name="김수험" number="0021" />);
  expect(audience.queryByText("홍길동")).toBeNull();
  expect(audience.getByText("김수험").isConnected).toBe(true);
  expect(audience.getByText("0021").isConnected).toBe(true);
  expect(audience.queryByRole("button")).toBeNull();
  expect(audience.queryByRole("textbox")).toBeNull();
  const preview = popup.document.querySelector(".operator-candidate-preview");
  rerender(<Operator name="김수험" number="" />);
  expect(audience.queryByRole("dialog")).toBeNull();
  expect(popup.document.querySelector(".operator-candidate-display-draw-slot")).not.toBeNull();
  expect(popup.document.querySelector(".operator-candidate-preview")).toBe(preview);
});
