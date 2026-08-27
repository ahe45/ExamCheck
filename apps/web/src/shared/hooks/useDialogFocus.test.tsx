// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useDialogFocus } from "./useDialogFocus";

function Dialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const dialogRef = useDialogFocus<HTMLDivElement>(open);
  if (!open) return null;
  return (
    <div ref={dialogRef} role="dialog" aria-modal="true">
      <button>첫 번째</button>
      <input aria-label="가운데" />
      <button onClick={onClose}>닫기</button>
    </div>
  );
}

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>열기</button>
      <Dialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function PreservedStateHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <section aria-label="기존 비활성 영역" aria-hidden="true" inert={true}>
        기존 비활성 영역
      </section>
      <button onClick={() => setOpen(true)}>보존 열기</button>
      <Dialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function NestedDialogHarness() {
  const [outerOpen, setOuterOpen] = useState(false);
  const [innerOpen, setInnerOpen] = useState(false);
  const outerRef = useDialogFocus<HTMLDivElement>(outerOpen);
  const innerRef = useDialogFocus<HTMLDivElement>(innerOpen);
  return (
    <>
      <button onClick={() => setOuterOpen(true)}>바깥 열기</button>
      {outerOpen && (
        <div ref={outerRef} role="dialog" aria-label="바깥">
          <button>바깥 첫 번째</button>
          <button onClick={() => setInnerOpen(true)}>안쪽 열기</button>
          <button onClick={() => setOuterOpen(false)}>바깥 닫기</button>
          {innerOpen && (
            <div ref={innerRef} role="dialog" aria-label="안쪽">
              <button>안쪽 첫 번째</button>
              <button onClick={() => setInnerOpen(false)}>안쪽 닫기</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

afterEach(() => {
  document.body.style.overflow = "";
});

describe("useDialogFocus", () => {
  it("열릴 때 첫 요소로 이동하고 Tab을 순환한 뒤 닫힐 때 기존 포커스를 복원한다", async () => {
    render(<DialogHarness />);
    const opener = screen.getByRole("button", { name: "열기" });
    opener.focus();
    fireEvent.click(opener);

    const first = screen.getByRole("button", { name: "첫 번째" });
    const close = screen.getByRole("button", { name: "닫기" });
    expect(first).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    expect(opener).toHaveAttribute("inert");
    expect(opener).toHaveAttribute("aria-hidden", "true");

    close.focus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(close).toHaveFocus();

    fireEvent.click(close);
    await waitFor(() => expect(opener).toHaveFocus());
    expect(document.body.style.overflow).toBe("");
    expect(opener).not.toHaveAttribute("inert");
    expect(opener).not.toHaveAttribute("aria-hidden");
  });

  it("중첩 모달에서는 최상위만 순환하고 안쪽을 닫아도 body 잠금을 유지한다", async () => {
    render(<NestedDialogHarness />);
    const outerOpener = screen.getByRole("button", { name: "바깥 열기" });
    outerOpener.focus();
    fireEvent.click(outerOpener);
    const innerOpener = screen.getByRole("button", { name: "안쪽 열기" });
    innerOpener.focus();
    fireEvent.click(innerOpener);

    const innerFirst = screen.getByRole("button", { name: "안쪽 첫 번째" });
    const innerClose = screen.getByRole("button", { name: "안쪽 닫기" });
    expect(innerFirst).toHaveFocus();
    expect(innerOpener).toHaveAttribute("inert");
    expect(innerOpener).toHaveAttribute("aria-hidden", "true");
    innerClose.focus();
    fireEvent.keyDown(innerClose, { key: "Tab" });
    expect(innerFirst).toHaveFocus();

    fireEvent.click(innerClose);
    await waitFor(() => expect(innerOpener).toHaveFocus());
    expect(document.body.style.overflow).toBe("hidden");
    expect(innerOpener).not.toHaveAttribute("inert");
    expect(innerOpener).not.toHaveAttribute("aria-hidden");
    expect(outerOpener).toHaveAttribute("inert");

    fireEvent.click(screen.getByRole("button", { name: "바깥 닫기" }));
    await waitFor(() => expect(outerOpener).toHaveFocus());
    expect(document.body.style.overflow).toBe("");
    expect(outerOpener).not.toHaveAttribute("inert");
  });

  it("닫을 때 앱 바깥 영역의 기존 inert와 aria-hidden 값을 손실하지 않는다", async () => {
    render(<PreservedStateHarness />);
    const preserved = document.querySelector<HTMLElement>("[aria-label='기존 비활성 영역']");
    const opener = screen.getByRole("button", { name: "보존 열기" });
    opener.focus();
    fireEvent.click(opener);

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(opener).toHaveFocus());
    expect(preserved).toHaveAttribute("inert");
    expect(preserved).toHaveAttribute("aria-hidden", "true");
  });
});
