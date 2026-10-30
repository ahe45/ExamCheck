import { describe, expect, it } from "vitest";
import { buildDashboardStatistics } from "./dashboard-statistics";
import { attendanceViews } from "../../shared/navigation/admin-navigation";

describe("dashboard statistics", () => {
  it("운영 현황 카드를 가장 이른 날짜와 시간 순으로 정렬하고 미지정 일정은 뒤에 둔다", () => {
    const candidates = [
      { admission: "가 전형", date: "2026-10-22", time: "08:00", assignedNumber: null },
      { admission: "나 전형", date: "2026-10-21", time: "10:00", assignedNumber: null },
      { admission: "다 전형", date: "2026-10-21", time: "9:00", assignedNumber: null },
      { admission: "라 전형", assignedNumber: null },
      { admission: "마 전형", date: "2026-10-21", assignedNumber: null },
      { admission: "가 전형", date: "2026-10-20", time: "15:00", assignedNumber: null },
    ];
    const statistics = buildDashboardStatistics(candidates);

    expect(statistics.breakdowns.admission.map((row) => row.name)).toEqual([
      "가 전형",
      "다 전형",
      "나 전형",
      "마 전형",
      "라 전형",
    ]);
    expect(statistics.breakdowns.admission[0].total).toBe(2);
    expect(statistics.breakdowns.period.map((row) => row.name)).toEqual([
      "미지정 교시 · 2026.10.20 15:00",
      "미지정 교시 · 2026.10.21 9:00",
      "미지정 교시 · 2026.10.21 10:00",
      "미지정 교시 · 2026.10.21",
      "미지정 교시 · 2026.10.22 08:00",
      "미지정 교시",
    ]);
  });

  it.each(attendanceViews.filter((view) => view.key !== "candidate"))(
    "집계 합계를 $label 기준에서도 유지한다",
    ({ key }) => {
      const candidates = [
        {
          admission: "일반",
          unit: "음악",
          major: "피아노",
          group: "1조",
          date: "2026-10-21",
          time: "09:00",
          period: "1교시",
          building: "본관",
          room: "101",
          waitingRoom: "201",
          assignedNumber: "1",
        },
        {
          admission: "특별",
          unit: "음악",
          major: "피아노",
          group: "1조",
          date: "2026-10-22",
          time: "09:00",
          period: "1교시",
          building: "별관",
          room: "101",
          waitingRoom: "201",
          assignedNumber: null,
        },
      ];
      const groups = buildDashboardStatistics(candidates).breakdowns[key];
      expect(groups.reduce((sum, row) => sum + row.total, 0)).toBe(2);
      expect(groups.reduce((sum, row) => sum + row.assigned, 0)).toBe(1);
      expect(groups).toHaveLength(2);
    },
  );

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

  it("건물, 교시, 대기실 기준의 세부 운영 현황을 함께 계산한다", () => {
    const statistics = buildDashboardStatistics([
      {
        admission: "학생부교과",
        building: "본관",
        waitingRoom: "101호 대기실",
        date: "2026-09-01",
        time: "09:00",
        period: "1교시",
        assignedNumber: "1001",
      },
      {
        admission: "실기전형",
        building: "본관",
        waitingRoom: "101호 대기실",
        date: "2026-09-01",
        time: "09:00",
        period: "1교시",
        assignedNumber: null,
      },
    ]);

    expect(statistics.breakdowns.building).toEqual([
      { name: "본관", total: 2, assigned: 1, unassigned: 1, assignmentRate: 50, status: "progress" },
    ]);
    expect(statistics.breakdowns.period[0]).toMatchObject({ name: "1교시 · 2026.09.01 09:00", total: 2 });
    expect(statistics.breakdowns.waitingRoom[0]).toMatchObject({ name: "본관 · 101호 대기실", total: 2 });
  });
});
