// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteAdmission,
  fetchAdmissionOperationSchedules,
  resetAdmissionOperations,
} from "../../shared/api/pseudonyms";
import { AdmissionDeleteModal, AdmissionOperationsResetModal } from "./AdmissionDataActionModals";

vi.mock("../../shared/api/pseudonyms", () => ({
  deleteAdmission: vi.fn(),
  fetchAdmissionOperationSchedules: vi.fn(),
  resetAdmissionOperations: vi.fn(),
}));

describe("AdmissionOperationsResetModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("교시 목록에서 선택한 항목만 운영 이력 초기화 요청에 포함한다", async () => {
    vi.mocked(fetchAdmissionOperationSchedules).mockResolvedValue([
      {
        examDate: "2026-10-30",
        examTime: "09:00",
        periodName: "1교시",
        buildingNames: ["본관"],
        candidateCount: 20,
        assignedCount: 10,
        closed: false,
      },
      {
        examDate: "2026-10-30",
        examTime: "13:00",
        periodName: "2교시",
        buildingNames: ["별관"],
        candidateCount: 15,
        assignedCount: 15,
        closed: true,
      },
    ]);
    vi.mocked(resetAdmissionOperations).mockResolvedValue({
      resetScheduleCount: 1,
      deletedAssignmentCount: 10,
      deletedOperationCount: 1,
      resetRangeCount: 2,
    });
    const onCompleted = vi.fn();

    render(
      <AdmissionOperationsResetModal
        token="token"
        examName="2026년도 자격시험"
        admissionName="학생부교과"
        onClose={vi.fn()}
        onCompleted={onCompleted}
      />,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: /09:00 · 1교시/ }));
    expect(screen.queryByLabelText("초기화 비밀번호")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "선택 교시 초기화" }));
    expect(resetAdmissionOperations).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "초기화 비밀번호 확인" })).toBeVisible();
    expect(screen.getByRole("button", { name: "확인 후 초기화" })).toBeDisabled();
    expect(screen.getByLabelText("초기화 비밀번호")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("초기화 비밀번호"), { target: { value: "reset-password" } });
    fireEvent.click(screen.getByRole("button", { name: "확인 후 초기화" }));

    await waitFor(() =>
      expect(resetAdmissionOperations).toHaveBeenCalledWith("token", {
        examName: "2026년도 자격시험",
        admissionName: "학생부교과",
        password: "reset-password",
        schedules: [{ examDate: "2026-10-30", examTime: "09:00", periodName: "1교시" }],
      }),
    );
    expect(onCompleted).toHaveBeenCalledWith(1, 10);
  });
});

it.each(["reset", "delete"] as const)(
  "%s 비밀번호 오류 시 창을 유지하고 비밀번호를 비워 재입력하도록 한다",
  async (action) => {
    vi.clearAllMocks();
    vi.mocked(fetchAdmissionOperationSchedules).mockResolvedValue([
      {
        examDate: "2026-10-30",
        examTime: "09:00",
        periodName: "1교시",
        buildingNames: [],
        candidateCount: 1,
        assignedCount: 1,
        closed: false,
      },
    ]);
    const api = action === "reset" ? resetAdmissionOperations : deleteAdmission;
    vi.mocked(api).mockRejectedValueOnce(new Error("초기화 비밀번호가 올바르지 않습니다."));
    const onCompleted = vi.fn();
    const onClose = vi.fn();
    if (action === "reset") {
      render(
        <AdmissionOperationsResetModal
          token="token"
          examName="시험"
          admissionName="학생부교과"
          onClose={onClose}
          onCompleted={onCompleted}
        />,
      );
      fireEvent.click(await screen.findByRole("checkbox", { name: /09:00 · 1교시/ }));
      fireEvent.click(screen.getByRole("button", { name: "선택 교시 초기화" }));
    } else {
      render(
        <AdmissionDeleteModal token="token" admissionName="학생부교과" onClose={onClose} onCompleted={onCompleted} />,
      );
    }
    const field = screen.getByLabelText("초기화 비밀번호");
    fireEvent.change(field, { target: { value: "wrong-password" } });
    fireEvent.submit(field.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("초기화 비밀번호가 올바르지 않습니다.");
    expect(onCompleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(field).toHaveValue("");
    expect(
      screen.getByRole("button", { name: action === "reset" ? "확인 후 초기화" : "전형 전체 삭제" }),
    ).toBeDisabled();
  },
);

it("비밀번호 창을 취소하거나 Escape로 닫으면 초기화하지 않고 선택한 교시를 유지한다", async () => {
  vi.clearAllMocks();
  vi.mocked(fetchAdmissionOperationSchedules).mockResolvedValue([
    {
      examDate: "2026-10-30",
      examTime: "09:00",
      periodName: "1교시",
      buildingNames: [],
      candidateCount: 1,
      assignedCount: 1,
      closed: false,
    },
  ]);
  const onClose = vi.fn();
  render(
    <AdmissionOperationsResetModal
      token="token"
      examName="시험"
      admissionName="학생부교과"
      onClose={onClose}
      onCompleted={vi.fn()}
    />,
  );
  const checkbox = await screen.findByRole("checkbox", { name: /09:00 · 1교시/ });
  expect(screen.getByRole("button", { name: "선택 교시 초기화" })).toBeDisabled();
  fireEvent.click(checkbox);
  for (const cancel of ["button", "escape"]) {
    const trigger = screen.getByRole("button", { name: "선택 교시 초기화" });
    trigger.focus();
    fireEvent.click(trigger);
    const password = screen.getByLabelText("초기화 비밀번호");
    expect(password).toHaveValue("");
    fireEvent.change(password, { target: { value: "do-not-save" } });
    if (cancel === "button") fireEvent.click(screen.getByRole("button", { name: "취소" }));
    else fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "초기화 비밀번호 확인" })).not.toBeInTheDocument();
    expect(checkbox).toBeChecked();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(onClose).not.toHaveBeenCalled();
    expect(resetAdmissionOperations).not.toHaveBeenCalled();
  }
});

describe("AdmissionDeleteModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("초기화 비밀번호를 입력해야 전형 전체 삭제를 요청한다", async () => {
    vi.mocked(deleteAdmission).mockResolvedValue({
      deleted: true,
      admissionName: "학생부교과",
      deletedCandidateCount: 30,
      deletedAssignmentCount: 20,
      deletedOperationCount: 2,
      deletedSettingCount: 1,
      deletedRangeCount: 2,
      deletedAccountAssignmentCount: 1,
    });
    const onCompleted = vi.fn();

    render(
      <AdmissionDeleteModal token="token" admissionName="학생부교과" onClose={vi.fn()} onCompleted={onCompleted} />,
    );

    const deleteButton = screen.getByRole("button", { name: "전형 전체 삭제" });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("초기화 비밀번호"), { target: { value: "1234" } });
    fireEvent.click(deleteButton);

    await waitFor(() => expect(deleteAdmission).toHaveBeenCalledWith("token", "학생부교과", "1234"));
    expect(onCompleted).toHaveBeenCalledWith(30);
  });
});
