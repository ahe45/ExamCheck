import { describe, expect, it } from "vitest";
import { candidateFieldKeys, candidateFields, candidateKey, type CandidateInput } from "./candidate-fields.js";

describe("candidate field definitions", () => {
  it("keeps the workbook keys and database columns in one complete, ordered mapping", () => {
    expect(candidateFields.map(({ key, dbColumn, label }) => [key, dbColumn, label])).toEqual([
      ["designatedSort", "designated_sort", "지정정렬"],
      ["date", "exam_date", "시험날짜"],
      ["time", "start_time", "시험시간"],
      ["period", "period_name", "교시명"],
      ["admission", "admission", "전형명"],
      ["unit", "unit_name", "모집단위명"],
      ["major", "major", "전공명"],
      ["building", "building_name", "고사건물명"],
      ["waitingRoom", "waiting_room", "대기실명"],
      ["room", "room_name", "고사실명"],
      ["examineeNo", "examinee_no", "수험번호"],
      ["temporaryNo", "temporary_no", "가번호"],
      ["name", "name", "이름"],
      ["birth", "birth_date", "생년월일"],
      ["group", "group_name", "조"],
      ["opt1", "opt1", "OPT1"],
      ["opt2", "opt2", "OPT2"],
      ["opt3", "opt3", "OPT3"],
    ]);
    expect(candidateFieldKeys).toEqual(candidateFields.map((field) => field.key));
    expect(new Set(candidateFieldKeys).size).toBe(candidateFields.length);
    expect(new Set(candidateFields.map((field) => field.dbColumn)).size).toBe(candidateFields.length);
  });

  it("preserves the assignment-critical protected field semantics", () => {
    expect(candidateFields.filter((field) => field.operationallyProtected).map((field) => field.key)).toEqual([
      "admission",
      "unit",
      "major",
      "building",
      "waitingRoom",
      "room",
      "temporaryNo",
    ]);
  });

  it("requires the waiting room and keeps the exam room optional", () => {
    expect(candidateFields.find((field) => field.key === "waitingRoom")?.optional).not.toBe(true);
    expect(candidateFields.find((field) => field.key === "room")?.optional).toBe(true);
  });

  it("identifies an uploaded candidate row by number, date, start time, period, and building", () => {
    const base = candidate();
    const reassigned: CandidateInput = {
      ...base,
      admission: "다른 전형",
      waitingRoom: "별관 대기실",
      room: "",
    };

    expect(candidateKey(reassigned)).toBe(candidateKey(base));
    expect(candidateKey({ ...base, building: "별관" })).not.toBe(candidateKey(base));
    expect(candidateKey({ ...base, time: "13:00" })).not.toBe(candidateKey(base));
    expect(candidateKey({ ...base, period: "2교시" })).not.toBe(candidateKey(base));
  });
});

function candidate(): CandidateInput {
  return {
    designatedSort: "",
    date: "2026-09-01",
    time: "09:00",
    period: "1교시",
    admission: "일반전형",
    unit: "디자인학부",
    major: "",
    building: "본관",
    waitingRoom: "본관 대기실",
    room: "101호",
    examineeNo: "10001",
    temporaryNo: "",
    name: "홍길동",
    birth: "2000-01-01",
    group: "",
    opt1: "",
    opt2: "",
    opt3: "",
  };
}
