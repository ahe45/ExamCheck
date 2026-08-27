import { describe, expect, it } from "vitest";
import type { CandidateRecord } from "../../shared/api/candidates";
import type { PseudonymSetting } from "../../shared/api/pseudonyms";
import {
  assignmentMethodDetail,
  assignmentMethodLabel,
  groupAdmissions,
  rangeSummary,
} from "./system-settings-overview-model";

describe("system settings overview model", () => {
  it("수험생을 전형별로 묶고 날짜·일정·건물을 중복 없이 집계한다", () => {
    const candidates = [
      {
        admission: "나 전형",
        date: "2026-10-31",
        time: "10:00",
        period: "오전",
        building: "본관",
      },
      {
        admission: "가 전형",
        date: "2026-10-30",
        time: "10:00",
        period: "오전",
        building: "별관",
      },
      {
        admission: "가 전형",
        date: "2026-10-30",
        time: "10:00",
        period: "오전",
        building: "별관",
      },
      {
        admission: "가 전형",
        date: "2026-10-30",
        time: "14:00",
        period: "오후",
        building: "본관",
      },
      { admission: " ", date: "", time: "", period: "", building: "" },
    ] as CandidateRecord[];

    expect(groupAdmissions(candidates)).toEqual([
      {
        name: "가 전형",
        candidates: 3,
        dates: 1,
        schedules: 2,
        buildings: ["별관", "본관"],
      },
      {
        name: "나 전형",
        candidates: 1,
        dates: 1,
        schedules: 1,
        buildings: ["본관"],
      },
    ]);
  });

  it("부여 방식과 설정 범위를 카드용 문구로 변환한다", () => {
    const setting = {
      assignmentMethod: "DRAW",
      autoDrawEnabled: true,
      autoDrawDelaySeconds: 3,
      printPreassignedLabel: false,
      ranges: [
        { rangeStart: 1001, rangeEnd: 1030 },
        { rangeStart: 2001, rangeEnd: 2030 },
      ],
    } as PseudonymSetting;

    expect(assignmentMethodLabel(setting.assignmentMethod)).toBe("추첨");
    expect(assignmentMethodDetail(setting)).toBe("자동 추첨 · 3초 지연");
    expect(rangeSummary(setting)).toBe("2개 범위 · 1,001 ~ 2,030");
  });
});
