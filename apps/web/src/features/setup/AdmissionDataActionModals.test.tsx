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
    fireEvent.click(screen.getByRole("button", { name: "선택 교시 초기화" }));

    await waitFor(() =>
      expect(resetAdmissionOperations).toHaveBeenCalledWith("token", {
        examName: "2026년도 자격시험",
        admissionName: "학생부교과",
        schedules: [{ examDate: "2026-10-30", examTime: "09:00", periodName: "1교시" }],
      }),
    );
    expect(onCompleted).toHaveBeenCalledWith(1, 10);
  });
});

describe("AdmissionDeleteModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("현재 비밀번호를 입력해야 전형 전체 삭제를 요청한다", async () => {
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
    fireEvent.change(screen.getByLabelText("현재 로그인한 계정의 비밀번호"), { target: { value: "1234" } });
    fireEvent.click(deleteButton);

    await waitFor(() => expect(deleteAdmission).toHaveBeenCalledWith("token", "학생부교과", "1234"));
    expect(onCompleted).toHaveBeenCalledWith(30);
  });
});
