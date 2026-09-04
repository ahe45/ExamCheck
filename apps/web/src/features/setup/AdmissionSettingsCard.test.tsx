// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PseudonymSetting } from "../../shared/api/pseudonyms";
import { AdmissionSettingsCard } from "./AdmissionSettingsCard";

describe("AdmissionSettingsCard", () => {
  it("전형 집계와 설정 요약을 표시하고 카드 클릭으로 전형명을 전달한다", () => {
    const onOpen = vi.fn();
    const onReset = vi.fn();
    const onDelete = vi.fn();
    render(
      <AdmissionSettingsCard
        card={{
          name: "학생부교과 면접",
          candidates: 30,
          dates: 1,
          schedules: 2,
          buildings: ["본관"],
          error: false,
          setting: {
            assignmentMethod: "SEQUENTIAL",
            autoAssignAbsenteesOnClose: true,
            deleteAbsenteeInfoOnReopen: false,
            useCandidatePhotos: true,
            enableBulkDraw: false,
            ranges: [{ rangeStart: 1001, rangeEnd: 1030 }],
          } as PseudonymSetting,
        }}
        onOpen={onOpen}
        onReset={onReset}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByText("30명")).toBeInTheDocument();
    expect(screen.getByText("순차부여")).toBeInTheDocument();
    expect(screen.getByText("1개 범위 · 1,001 ~ 1,030")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "학생부교과 면접 설정 열기" }));
    expect(onOpen).toHaveBeenCalledWith("학생부교과 면접");

    fireEvent.click(screen.getByRole("button", { name: "초기화" }));
    expect(onReset).toHaveBeenCalledWith("학생부교과 면접");
    expect(onOpen).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(onDelete).toHaveBeenCalledWith("학생부교과 면접");
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
