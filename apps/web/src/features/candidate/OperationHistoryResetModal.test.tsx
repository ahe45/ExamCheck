// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { OperationHistoryResetModal } from "./OperationHistoryResetModal";

const api = vi.hoisted(() => ({ resetOperationHistory: vi.fn() }));
vi.mock("../../shared/api/pseudonyms", () => api);
const schedule = {
  date: "2038-05-17",
  time: "09:00",
  periodName: "1교시",
  admissionName: "전형",
  buildingNames: [],
  candidateCount: 3,
  assignedCount: 2,
  printedCount: 0,
  labelPrintingEnabled: false,
};
beforeEach(() => {
  api.resetOperationHistory.mockReset();
});

it("requires a password and submits the exact visible scope only once", async () => {
  let resolve!: (value: unknown) => void;
  api.resetOperationHistory.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const onReset = vi.fn().mockResolvedValue(undefined);
  render(
    <OperationHistoryResetModal
      token="token"
      examName="시험"
      schedule={schedule}
      labelPrintingEnabled
      onClose={vi.fn()}
      onReset={onReset}
    />,
  );
  const button = screen.getByRole("button", { name: "이력 초기화" });
  expect(button).toBeDisabled();
  expect(screen.getByText("전체 수험생의 라벨 출력이력")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("초기화 비밀번호"), { target: { value: "secret" } });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(api.resetOperationHistory).toHaveBeenCalledExactlyOnceWith("token", {
    examName: "시험",
    examDate: schedule.date,
    examTime: schedule.time,
    periodName: schedule.periodName,
    admissionName: schedule.admissionName,
    password: "secret",
    mode: "LABEL",
  });
  expect(onReset).not.toHaveBeenCalled();
  await act(async () => resolve({ mode: "LABEL" }));
  expect(onReset).toHaveBeenCalledTimes(1);
});

it("keeps the dialog open after rejection and clears the password without clearing history locally", async () => {
  api.resetOperationHistory.mockRejectedValue(new Error("초기화 비밀번호가 올바르지 않습니다."));
  const onReset = vi.fn();
  const onClose = vi.fn();
  render(
    <OperationHistoryResetModal
      token="token"
      examName="시험"
      schedule={schedule}
      labelPrintingEnabled={false}
      onClose={onClose}
      onReset={onReset}
    />,
  );
  fireEvent.change(screen.getByLabelText("초기화 비밀번호"), { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "이력 초기화" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("올바르지"));
  expect(screen.getByLabelText("초기화 비밀번호")).toHaveValue("");
  expect(onReset).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(api.resetOperationHistory.mock.calls[0]![1].mode).toBe("ASSIGNMENT");
});
