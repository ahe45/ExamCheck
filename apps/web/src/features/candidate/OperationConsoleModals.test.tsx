// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OperationSchedule } from "../../shared/api/examinees";
import { OperationPrintModal, OperationScheduleMismatchModal } from "./OperationConsoleModals";

describe("operation console modal focus", () => {
  it("교시 불일치 안내가 열리면 닫기 버튼으로 포커스를 이동한다", async () => {
    const onClose = vi.fn();
    render(
      <OperationScheduleMismatchModal
        mismatch={{
          examineeNo: "1162001",
          name: "김수험",
          schedules: [
            {
              examineeNo: "1162001",
              name: "김수험",
              examDate: "2026-10-30",
              examTime: "14:00",
              periodName: "오후",
              admissionName: "학생부교과 면접",
              buildingName: "본관",
              roomName: "101호",
            },
          ],
        }}
        onClose={onClose}
      />,
    );

    const closeButton = screen.getByRole("button", { name: "교시 안내창 닫기" });
    await waitFor(() => expect(closeButton).toHaveFocus());
  });
});

describe("operation print modal", () => {
  it("shows signer-name fields requested by the selected template", () => {
    const schedule: OperationSchedule = {
      date: "2026-10-30",
      time: "10:00",
      periodName: "오전",
      admissionName: "학생부교과 면접",
      buildingNames: ["본관"],
      candidateCount: 1,
      assignedCount: 1,
    };
    render(
      <OperationPrintModal
        schedule={schedule}
        templates={[]}
        selectedTemplateCode=""
        loading={false}
        generating={false}
        progress={null}
        signatureFields={[
          { key: "signature.author", label: "작성자" },
          { key: "signature.reviewer", label: "확인자" },
        ]}
        signatureNames={{ "signature.author": "", "signature.reviewer": "" }}
        onSelect={vi.fn()}
        onSignatureNameChange={vi.fn()}
        onClose={vi.fn()}
        onGenerate={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox", { name: "작성자 이름" })).toBeRequired();
    expect(screen.getByRole("textbox", { name: "확인자 이름" })).toBeRequired();
  });
});
