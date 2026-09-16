// @vitest-environment jsdom

import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Examinee } from "../../shared/api/examinees";
import { OperationControlPanel } from "./OperationControlPanel";

describe("OperationControlPanel", () => {
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
