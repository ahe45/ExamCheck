// @vitest-environment jsdom

import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Examinee } from "../../shared/api/examinees";
import { OperationControlPanel } from "./OperationControlPanel";

describe("OperationControlPanel", () => {
  it("라벨 출력 시 검색 버튼 우측에 출력 n매 입력을 표시하고 변경값을 전달한다", () => {
    const onLabelCopiesChange = vi.fn();
    const props = {
      previewRef: createRef<HTMLElement>(),
      input: "10001",
      searching: false,
      notice: null,
      candidate: null,
      useCandidatePhotos: false,
      photoUrl: null,
      selectedMode: "PREASSIGNED" as const,
      assignment: null,
      onSearch: vi.fn(),
      onInput: vi.fn(),
      onReset: vi.fn(),
      onCloseNotice: vi.fn(),
      labelCopies: 3,
      labelCopiesValid: true,
      onLabelCopiesChange,
    };
    const view = render(<OperationControlPanel {...props} labelPrintingEnabled />);
    const copies = screen.getByRole("spinbutton", { name: "라벨 출력 매수" });
    expect(copies).toHaveValue(3);
    expect(copies.parentElement).toHaveTextContent("출력매");
    expect(copies.parentElement?.previousElementSibling).toBe(screen.getByRole("button", { name: "수험자 검색" }));
    fireEvent.change(copies, { target: { value: "4" } });
    expect(onLabelCopiesChange).toHaveBeenCalledWith(4);
    fireEvent.change(copies, { target: { value: "" } });
    expect(onLabelCopiesChange).toHaveBeenCalledWith("");
    view.rerender(<OperationControlPanel {...props} labelPrintingEnabled processing />);
    expect(copies).toBeDisabled();
    view.rerender(<OperationControlPanel {...props} labelPrintingEnabled={false} />);
    expect(screen.queryByRole("spinbutton", { name: "라벨 출력 매수" })).not.toBeInTheDocument();
  });
  it("답안지 사용 시 조회창 안내를 바꾸고 답안지 값의 내부 공백을 유지한다", () => {
    const onInput = vi.fn();
    render(
      <OperationControlPanel
        previewRef={createRef<HTMLElement>()}
        input=""
        searching={false}
        notice={null}
        candidate={null}
        useCandidatePhotos={false}
        useAnswerSheet
        photoUrl={null}
        selectedMode="MANUAL"
        assignment={null}
        onSearch={vi.fn()}
        onInput={onInput}
        onReset={vi.fn()}
        onCloseNotice={vi.fn()}
      />,
    );
    const input = screen.getByRole("textbox", { name: "답안지" });
    expect(input).toHaveAttribute("placeholder", "답안지 입력 또는 스캔");
    fireEvent.change(input, { target: { value: "A 001" } });
    expect(onInput).toHaveBeenCalledWith("A 001");
  });

  it("응시·결시 선택과 고정을 표시하고 설정이 꺼지면 숨긴다", () => {
    const props = {
      previewRef: createRef<HTMLElement>(),
      input: "",
      searching: false,
      notice: null,
      candidate: null,
      useCandidatePhotos: false,
      photoUrl: null,
      selectedMode: "MANUAL" as const,
      assignment: null,
      onSearch: vi.fn(),
      onInput: vi.fn(),
      onReset: vi.fn(),
      onCloseNotice: vi.fn(),
      onRegistrationAbsent: vi.fn(),
      onAttendanceLocked: vi.fn(),
    };
    const { rerender } = render(<OperationControlPanel {...props} showAttendanceSelection />);
    expect(screen.getByRole("button", { name: "응시" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "결시" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "고정" }));
    expect(props.onRegistrationAbsent).toHaveBeenCalledWith(true);
    expect(props.onAttendanceLocked).toHaveBeenCalledWith(true);
    rerender(
      <OperationControlPanel {...props} showAttendanceSelection registrationAbsent attendanceLocked processing />,
    );
    expect(screen.getByRole("checkbox", { name: "고정" })).toBeChecked();
    expect(screen.getByRole("button", { name: "결시" })).toBeDisabled();
    rerender(<OperationControlPanel {...props} showAttendanceSelection={false} />);
    expect(screen.queryByRole("group", { name: "등록 상태" })).toBeNull();
  });
  it("사전 가번호를 즉시 표시하고 불러오기 버튼은 표시하지 않는다", () => {
    render(
      <OperationControlPanel
        previewRef={createRef<HTMLElement>()}
        input="10001"
        searching={false}
        notice={null}
        candidate={preassignedExaminee()}
        useCandidatePhotos={false}
        photoUrl={null}
        selectedMode="PREASSIGNED"
        assignment={null}
        onSearch={vi.fn()}
        onInput={vi.fn()}
        onReset={vi.fn()}
        onCloseNotice={vi.fn()}
      />,
    );

    expect(screen.getByText("가번호")).toBeInTheDocument();
    expect(screen.getByText("0821")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /사전 가번호 불러오기/ })).not.toBeInTheDocument();
  });
});

function preassignedExaminee(): Examinee {
  return {
    id: 1,
    examineeNo: "10001",
    name: "홍길동",
    birthDate: "2000-01-01",
    examName: "2026년도 자격시험",
    examDate: "2026-10-30",
    roomName: "101호",
    waitingRoom: "201호 대기실",
    seatNo: "1",
    labelBarcode: "10001",
    preassignedNumber: "0821",
    preassignedAvailable: true,
    assignedNumber: "0821",
    assignmentMode: "PREASSIGNED",
    assignedAt: null,
    status: "ACTIVE",
    examTime: "10:00",
    examEndTime: "11:00",
    periodName: "1교시",
    periodCode: "1",
    admissionName: "일반전형",
    admissionCode: "A01",
    unitName: "컴퓨터공학과",
    unitCode: "U01",
    majorName: "컴퓨터공학",
    majorCode: "M01",
    buildingName: "본관",
    buildingCode: "B01",
    roomCode: "R01",
    groupName: "A조",
    opt1: "",
    opt2: "",
    opt3: "",
    absent: false,
  };
}
