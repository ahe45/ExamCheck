import { describe, expect, it } from "vitest";
import { buildDashboardStatistics } from "./dashboard-statistics";

describe("dashboard statistics", () => {
  it("수험생을 전형별로 묶고 가번호 부여 상태를 계산한다", () => {
    const statistics = buildDashboardStatistics([
      { admission: "학생부교과", assignedNumber: null },
      { admission: "학생부교과", assignedNumber: "1001" },
      { admission: "실기전형", assignedNumber: "2001" },
      { admission: "실기전형", assignedNumber: "2002" },
      { admission: "면접전형", assignedNumber: null },
    ]);

    expect(statistics.totalCandidates).toBe(5);
    expect(statistics.assignedCandidates).toBe(3);
    expect(statistics.assignmentRate).toBe(60);
    expect(statistics.admissionCounts).toEqual({ waiting: 1, progress: 1, complete: 1 });
    expect(statistics.admissions.find((item) => item.name === "학생부교과")).toMatchObject({
      total: 2,
      assigned: 1,
      unassigned: 1,
      assignmentRate: 50,
      status: "progress",
    });
  });

  it("전형명이 비어 있으면 미지정 전형으로 집계한다", () => {
    const statistics = buildDashboardStatistics([{ admission: "", assignedNumber: null }]);
    expect(statistics.admissions[0]).toMatchObject({ name: "미지정 전형", status: "waiting" });
  });
});
