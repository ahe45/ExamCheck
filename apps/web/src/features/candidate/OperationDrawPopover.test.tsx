// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { PseudonymAssignment } from "../../shared/api/pseudonyms";
import { OperationDrawPopover } from "./OperationDrawPopover";

function props() {
  return {
    position: { left: 0, top: 0 },
    assignment: null,
    previewNumber: 1001,
    autoDrawEnabled: false,
    remainingMs: 0,
    delaySeconds: 3,
    canAssign: true,
    assigning: false,
    onClose: vi.fn(),
    onAssign: vi.fn(),
  };
}

it("F9 confirms only a completed draw, while F2 cannot dismiss it", () => {
  const input = props();
  const { rerender, unmount, container } = render(<OperationDrawPopover {...input} />);
  fireEvent.keyDown(document, { key: "F9" });
  expect(input.onClose).not.toHaveBeenCalled();
  rerender(<OperationDrawPopover {...input} assignment={{ pseudonymNumber: "1001" } as PseudonymAssignment} />);
  const button = screen.getByRole("button", { name: "확인" });
  expect(button).toHaveAttribute("aria-keyshortcuts", "F9");
  for (const event of [{ key: "F3" }, { key: "F2" }, { key: "F9", repeat: true }, { key: "F9", ctrlKey: true }]) {
    fireEvent.keyDown(document, event);
  }
  container.setAttribute("inert", "");
  fireEvent.keyDown(document, { key: "F9" });
  container.removeAttribute("inert");
  expect(input.onClose).not.toHaveBeenCalled();
  expect(input.onAssign).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "F9" });
  expect(input.onClose).toHaveBeenCalledTimes(1);
  unmount();
  fireEvent.keyDown(document, { key: "F9" });
  expect(input.onClose).toHaveBeenCalledTimes(1);
});

it("추첨 버튼에 포커스를 이동하고 Enter로 추첨하며 검색 Enter와 F2는 추첨하지 않는다", () => {
  const input = props();
  const { unmount } = render(
    <>
      <input aria-label="수험번호" />
      <OperationDrawPopover {...input} />
    </>,
  );
  const field = screen.getByRole("textbox");
  const button = screen.getByRole("button", { name: "가번호 추첨" });
  expect(button).toHaveFocus();
  expect(button).toHaveAttribute("aria-keyshortcuts", "Enter");
  fireEvent.keyDown(field, { key: "Enter" });
  fireEvent.keyDown(button, { key: "F2" });
  expect(input.onAssign).not.toHaveBeenCalled();
  fireEvent.keyDown(button, { key: "Enter" });
  expect(input.onAssign).toHaveBeenCalledTimes(1);
  fireEvent.click(button);
  expect(input.onAssign).toHaveBeenCalledTimes(2);
  unmount();
  fireEvent.keyDown(button, { key: "Enter" });
  expect(input.onAssign).toHaveBeenCalledTimes(2);
});

it("ignores held keys, modifier combinations, disabled actions, completed draws and other open modals", () => {
  const input = props();
  const { rerender, container } = render(<OperationDrawPopover {...input} />);
  for (const event of [
    { repeat: true },
    { ctrlKey: true },
    { altKey: true },
    { shiftKey: true },
    { metaKey: true },
    { isComposing: true },
  ]) {
    fireEvent.keyDown(
      screen.getByRole("dialog").querySelector("button.operator-draw-action, button.operator-draw-confirm")!,
      { key: "Enter", ...event },
    );
  }
  rerender(<OperationDrawPopover {...input} assigning />);
  fireEvent.keyDown(
    screen.getByRole("dialog").querySelector("button.operator-draw-action, button.operator-draw-confirm")!,
    { key: "Enter" },
  );
  rerender(<OperationDrawPopover {...input} canAssign={false} />);
  fireEvent.keyDown(
    screen.getByRole("dialog").querySelector("button.operator-draw-action, button.operator-draw-confirm")!,
    { key: "Enter" },
  );
  rerender(<OperationDrawPopover {...input} assignment={{ pseudonymNumber: "1001" } as PseudonymAssignment} />);
  fireEvent.keyDown(
    screen.getByRole("dialog").querySelector("button.operator-draw-action, button.operator-draw-confirm")!,
    { key: "Enter" },
  );
  rerender(<OperationDrawPopover {...input} />);
  container.setAttribute("inert", "");
  fireEvent.keyDown(
    screen.getByRole("dialog").querySelector("button.operator-draw-action, button.operator-draw-confirm")!,
    { key: "Enter" },
  );
  expect(input.onAssign).not.toHaveBeenCalled();
});

it("순차부여는 서식이 유지된 예정 번호와 저장 버튼을 표시하고 자동 추첨하지 않는다", () => {
  const input = props();
  const { rerender } = render(<OperationDrawPopover {...input} sequential autoDrawEnabled previewLoading />);
  expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  fireEvent.keyDown(document, { key: "F2" });
  expect(input.onAssign).not.toHaveBeenCalled();
  const onManualNumber = vi.fn();
  rerender(
    <OperationDrawPopover
      {...input}
      sequential
      autoDrawEnabled
      sequentialPreviewNumber="0017"
      manualNumber="0017"
      onManualNumber={onManualNumber}
    />,
  );
  expect(screen.getByRole("dialog", { name: "가번호 순차부여" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "가번호" })).toHaveValue("0017");
  expect(screen.getByRole("textbox", { name: "가번호" })).not.toHaveAttribute("readonly");
  fireEvent.change(screen.getByRole("textbox", { name: "가번호" }), { target: { value: "00a18" } });
  expect(onManualNumber).toHaveBeenCalledWith("0018");
  expect(screen.queryByRole("progressbar")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(input.onAssign).toHaveBeenCalledTimes(1);
  rerender(
    <OperationDrawPopover {...input} sequential assignment={{ pseudonymNumber: "0017" } as PseudonymAssignment} />,
  );
  expect(screen.getByText("저장 완료")).toBeVisible();
  fireEvent.keyDown(document, { key: "F9" });
  expect(input.onClose).toHaveBeenCalledTimes(1);
});

it("매칭 입력란은 비어 있고 포커스를 받으며 숫자 입력 후 저장할 수 있다", () => {
  const input = props();
  const onManualNumber = vi.fn();
  const { rerender } = render(<OperationDrawPopover {...input} matching onManualNumber={onManualNumber} />);
  const field = screen.getByRole("textbox", { name: "가번호" });
  expect(field).toHaveValue("");
  expect(field).toHaveFocus();
  expect(field).not.toHaveAttribute("readonly");
  expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  fireEvent.keyDown(field, { key: "Enter" });
  expect(input.onAssign).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: "00a17" } });
  expect(onManualNumber).toHaveBeenCalledWith("0017");
  rerender(<OperationDrawPopover {...input} matching manualNumber="0017" onManualNumber={onManualNumber} />);
  fireEvent.keyDown(field, { key: "Enter" });
  expect(input.onAssign).toHaveBeenCalledTimes(1);
  rerender(<OperationDrawPopover {...input} matching manualNumber="0017" onManualNumber={onManualNumber} assigning />);
  expect(field).toHaveAttribute("readonly");
  expect(screen.getByRole("button", { name: "저장 중…" })).toBeDisabled();
});

it("저장 Enter는 팝오버에서만 동작하고 검색 Enter와 F2 및 반복 입력을 무시한다", () => {
  const input = props();
  render(
    <>
      <input aria-label="수험번호" />
      <OperationDrawPopover {...input} sequential sequentialPreviewNumber="1001" manualNumber="1001" />
    </>,
  );
  const field = screen.getByRole("textbox", { name: "가번호" });
  const button = screen.getByRole("button", { name: "저장" });
  expect(field).toHaveFocus();
  expect(button).toHaveAttribute("aria-keyshortcuts", "Enter");
  fireEvent.keyDown(screen.getByRole("textbox", { name: "수험번호" }), { key: "Enter" });
  fireEvent.keyDown(field, { key: "F2" });
  for (const details of [
    { repeat: true },
    { isComposing: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { metaKey: true },
  ]) {
    fireEvent.keyDown(field, { key: "Enter", ...details });
    fireEvent.keyDown(button, { key: "Enter", ...details });
  }
  expect(input.onAssign).not.toHaveBeenCalled();
  fireEvent.keyDown(field, { key: "Enter" });
  expect(input.onAssign).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(button, { key: "Enter" });
  expect(input.onAssign).toHaveBeenCalledTimes(2);
});
