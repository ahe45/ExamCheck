// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OperationSchedule } from "../../shared/api/examinees";
import type { FormTemplate } from "../../shared/api/form-templates";
import {
  OperationFinishModal,
  OperationPrintModal,
  OperationScheduleMismatchModal,
  OperationSignatureModal,
} from "./OperationConsoleModals";

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
  it("shows counts for both targets and disables generation for an empty target", () => {
    const onTarget = vi.fn();
    const props = {
      schedule: { date: "2026-10-30", time: "10:00", periodName: "오전", admissionName: "면접" } as OperationSchedule,
      templates: [
        { id: 1, code: "PHOTO", name: "사진대장", category: "문서", usageScope: "CANDIDATE" },
      ] as FormTemplate[],
      selectedTemplateCode: "PHOTO",
      loading: false,
      generating: false,
      progress: null,
      printTarget: "ALL" as const,
      totalCount: 10,
      presentCount: 3,
      onPrintTargetChange: onTarget,
      onSelect: vi.fn(),
      onClose: vi.fn(),
      onGenerate: vi.fn(),
    };
    const view = render(<OperationPrintModal {...props} />);
    expect(screen.getByRole("radio", { name: "전체 (10명)" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "응시만 (3명)" }));
    expect(onTarget).toHaveBeenCalledWith("PRESENT");
    view.rerender(<OperationPrintModal {...props} printTarget="PRESENT" presentCount={0} />);
    expect(screen.getByRole("button", { name: "PDF 생성" })).toBeDisabled();
    expect(screen.getByText("선택한 출력 대상에 해당하는 수험생이 없습니다.")).toBeInTheDocument();
    view.rerender(<OperationPrintModal {...props} generating />);
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
  });

  it("collects signer names in a separate dialog with submit and cancel actions", async () => {
    const onConfirm = vi.fn(),
      onClose = vi.fn(),
      onChange = vi.fn();
    render(
      <OperationSignatureModal
        templateName="가번호 부여대장"
        fields={[
          { key: "signature.author", label: "작성자" },
          { key: "signature.reviewer", label: "확인자" },
        ]}
        names={{ "signature.author": "김작성", "signature.reviewer": "이확인" }}
        error="작성자 이름을 입력해 주세요."
        onConfirm={onConfirm}
        onClose={onClose}
        onChange={onChange}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "서명자명 입력" });
    const author = screen.getByRole("textbox", { name: "작성자 이름" });
    await waitFor(() => expect(author).toHaveFocus());
    expect(author).toBeRequired();
    expect(screen.getByRole("textbox", { name: "확인자 이름" })).toBeRequired();
    expect(screen.getByRole("alert")).toHaveTextContent("작성자 이름을 입력해 주세요.");
    fireEvent.change(author, { target: { value: "새작성" } });
    expect(onChange).toHaveBeenCalledWith("signature.author", "새작성");
    fireEvent.submit(dialog);
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps signer-name inputs out of template selection", () => {
    const schedule: OperationSchedule = {
      date: "2026-10-30",
      time: "10:00",
      periodName: "오전",
      admissionName: "학생부교과 면접",
      buildingNames: ["본관"],
      candidateCount: 1,
      assignedCount: 1,
      printedCount: 0,
      labelPrintingEnabled: false,
    };
    render(
      <OperationPrintModal
        printTarget="ALL"
        onPrintTargetChange={vi.fn()}
        totalCount={10}
        presentCount={8}
        schedule={schedule}
        templates={[]}
        selectedTemplateCode=""
        loading={false}
        generating={false}
        progress={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onGenerate={vi.fn()}
      />,
    );

    expect(screen.queryByRole("textbox", { name: "작성자 이름" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "확인자 이름" })).not.toBeInTheDocument();
  });
});

it.each([false, true])(
  "마감 취소 확인창은 결시자 삭제 정책(%s)을 표시하고 확인 시 요청한다",
  (deleteAbsenteeInfoOnReopen) => {
    const onConfirm = vi.fn();
    render(
      <OperationFinishModal
        schedule={{
          date: "2026-10-30",
          time: "10:00",
          periodName: "오전",
          admissionName: "전형",
          buildingNames: [],
          candidateCount: 0,
          assignedCount: 0,
          printedCount: 0,
          labelPrintingEnabled: false,
        }}
        rows={[]}
        labelPrintingEnabled={false}
        autoAssignAbsenteesOnClose={false}
        reopening
        deleteAbsenteeInfoOnReopen={deleteAbsenteeInfoOnReopen}
        closing={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("alertdialog", { name: "등록 마감을 취소하시겠습니까?" })).toBeInTheDocument();
    expect(
      screen.getByText(
        deleteAbsenteeInfoOnReopen ? "마감 시 자동 부여된 결시자 가번호 삭제" : "기존 가번호 부여 내역 유지",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "마감 취소" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  },
);
