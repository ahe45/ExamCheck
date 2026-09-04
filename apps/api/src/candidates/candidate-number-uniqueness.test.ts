import { describe, expect, it } from "vitest";
import { assertCandidateNumberUniqueness, type CandidateRecordRow } from "./candidates.service.js";
import { candidateKey, type CandidateInput } from "./candidate-fields.js";

describe("candidate examinee number uniqueness policy", () => {
  it("rejects repeated numbers in one workbook under SYSTEM policy", () => {
    const first = candidate({ examineeNo: "10001", date: "2026-09-01", time: "09:00", period: "1교시" });
    const second = candidate({ examineeNo: "10001", date: "2026-09-01", time: "13:00", period: "2교시" });

    expect(() => assertCandidateNumberUniqueness([first, second], new Map(), "SYSTEM")).toThrow(
      "업로드 파일에 중복된 수험번호가 1개",
    );
  });

  it("allows repeated numbers in different schedules under SCHEDULE policy", () => {
    const first = candidate({ examineeNo: "10001", date: "2026-09-01", time: "09:00", period: "1교시" });
    const second = candidate({ examineeNo: "10001", date: "2026-09-01", time: "13:00", period: "2교시" });

    expect(() => assertCandidateNumberUniqueness([first, second], new Map(), "SCHEDULE")).not.toThrow();
  });

  it("allows an update of the same source row but rejects a new schedule under SYSTEM policy", () => {
    const currentInput = candidate({ examineeNo: "10001", date: "2026-09-01", time: "09:00", period: "1교시" });
    const current = { ...currentInput, id: 7 } as CandidateRecordRow;
    const existing = new Map([[candidateKey(current), current]]);

    expect(() => assertCandidateNumberUniqueness([currentInput], existing, "SYSTEM")).not.toThrow();
    expect(() =>
      assertCandidateNumberUniqueness(
        [candidate({ examineeNo: "10001", date: "2026-09-01", time: "13:00", period: "2교시" })],
        existing,
        "SYSTEM",
      ),
    ).toThrow("기존 데이터와 중복되는 수험번호가 1개");
  });
});

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
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
    ...overrides,
  };
}
