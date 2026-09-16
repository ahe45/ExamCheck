import { describe, expect, it } from "vitest";
import type { Examinee } from "../../shared/api/examinees";
import type { PseudonymAssignment } from "../../shared/api/pseudonyms";
import {
  drawViewModel,
  formatRegistrationTimestamp,
  operationColumnsFor,
  operationRosterStats,
  operationRowValue,
  toOperationRows,
  toRosterExportQuery,
} from "./operation-view-model";

function examinee(overrides: Partial<Examinee> = {}): Examinee {
  return {
    id: 1,
    examineeNo: "1162001",
    name: "이예민",
    birthDate: "2008-03-12",
    examName: "2026년도 자격시험",
    examDate: "2026-10-30",
    roomName: "101호",
    waitingRoom: "201호 대기실",
    seatNo: "1",
    labelBarcode: "1162001",
    preassignedNumber: null,
    preassignedAvailable: false,
    assignedNumber: null,
    assignmentMode: null,
    assignedAt: null,
    status: "ACTIVE",
    examTime: "10:00",
    examEndTime: "11:00",
    periodName: "오전",
    periodCode: "1",
    admissionName: "학생부교과 면접",
    admissionCode: "A01",
    unitName: "유아교육과",
    unitCode: "U01",
    majorName: "유아교육",
    majorCode: "M01",
    buildingName: "본관",
    buildingCode: "B01",
    roomCode: "R01",
    groupName: "A조",
    opt1: "",
    opt2: "",
    opt3: "",
    absent: false,
    ...overrides,
  };
}

const assignment: PseudonymAssignment = {
  id: 7,
  examineeNo: "1162001",
  examineeName: "이예민",
  examName: "2026년도 자격시험",
  pseudonymNumber: "1017",
  mode: "RANDOM",
  assignedAt: "2026-08-27T23:04:05",
  alreadyAssigned: true,
};

describe("operation view model", () => {
  const openRegistration = { operationClosed: false, labelPrintingEnabled: false };
  const closedRegistration = { operationClosed: true, labelPrintingEnabled: false };

  it("API 수험생을 운영 행으로 변환하고 진행·마감 상태와 응시 통계를 계산한다", () => {
    const rows = toOperationRows([
      examinee({
        assignedNumber: assignment.pseudonymNumber,
        assignmentMode: assignment.mode,
        assignedAt: assignment.assignedAt,
      }),
      examinee({ id: 2, examineeNo: "1162002", name: "안오훈", absent: true }),
      examinee({ id: 3, examineeNo: "1162003", name: "이오준" }),
    ]);

    expect(rows[0].assignment).toMatchObject({ pseudonymNumber: "1017", alreadyAssigned: true });
    expect(rows[1].assignment).toBeNull();
    expect(operationRowValue(rows[0], "status", openRegistration)).toBe("진행");
    expect(operationRowValue(rows[1], "status", openRegistration)).toBe("대기");
    expect(operationRowValue(rows[2], "status", openRegistration)).toBe("대기");
    expect(operationRowValue(rows[0], "attendance", openRegistration)).toBe("응시");
    expect(operationRowValue(rows[0], "attendance", closedRegistration)).toBe("응시");
    expect(operationRowValue(rows[1], "attendance", closedRegistration)).toBe("결시");
    expect(operationRowValue(rows[0], "status", closedRegistration)).toBe("마감");
    const stats = operationRosterStats(rows, closedRegistration);
    expect(stats).toMatchObject({
      totalCount: 3,
      assignedCount: 1,
      presentCount: 1,
      attendanceRateText: "33.3",
    });
    expect(stats.attendanceRate).toBeCloseTo(100 / 3);
    expect(
      toRosterExportQuery(
        { status: ["진행"], name: ["이예민", "이예민"] },
        { key: "examineeNo", direction: "desc" },
        operationColumnsFor(false),
      ),
    ).toEqual({
      filters: [
        { field: "name", mode: "include", values: ["이예민"] },
        { field: "status", mode: "include", values: ["진행"] },
      ],
      sort: { field: "examineeNo", direction: "desc" },
    });
  });

  it("등록일시를 yy.mm.dd. 24시간 시:분:초 형식으로 표시한다", () => {
    expect(formatRegistrationTimestamp("2026-08-27T23:04:05")).toBe("26.08.27. 23:04:05");
    expect(formatRegistrationTimestamp("")).toBe("-");
    expect(formatRegistrationTimestamp("알 수 없음")).toBe("알 수 없음");
  });

  it("업로드된 사전 가번호를 별도 불러오기 없이 등록 가번호로 표시한다", () => {
    const [row] = toOperationRows([
      examinee({
        preassignedNumber: "0821",
        preassignedAvailable: true,
        assignedNumber: "0821",
        assignmentMode: "PREASSIGNED",
      }),
    ]);

    expect(row.assignment).toMatchObject({ pseudonymNumber: "0821", mode: "PREASSIGNED", alreadyAssigned: true });
    expect(operationRowValue(row, "pseudonymNumber", openRegistration)).toBe("0821");
    expect(operationRowValue(row, "status", openRegistration)).toBe("진행");
    expect(operationRowValue(row, "status", { ...openRegistration, labelPrintingEnabled: true })).toBe("대기");
  });

  it("라벨 출력 방식은 등록일시 대신 실제 출력일시를 표시한다", () => {
    const [row] = toOperationRows([
      examinee({
        preassignedNumber: "0821",
        preassignedAvailable: true,
        assignedNumber: "0821",
        assignmentMode: "PREASSIGNED",
        lastPrintedAt: "2026-08-28T10:11:12",
      }),
    ]);
    const context = { operationClosed: false, labelPrintingEnabled: true };

    expect(operationColumnsFor(true).map((column) => column.label)).toContain("출력일시");
    expect(operationColumnsFor(true).map((column) => column.label)).not.toContain("등록일시");
    expect(operationRowValue(row, "printedAt", context)).toBe("26.08.28. 10:11:12");
    expect(operationRowValue(row, "attendance", context)).toBe("응시");
    expect(operationRowValue(row, "status", context)).toBe("진행");
  });

  it("자동 추첨 카운트다운과 완료 상태 표시를 결정한다", () => {
    expect(
      drawViewModel({
        assignment: null,
        previewNumber: 1007,
        autoDrawEnabled: true,
        remainingMs: 1500,
        delaySeconds: 3,
        canAssign: true,
        assigning: false,
      }),
    ).toMatchObject({
      complete: false,
      className: "operator-draw-popover rolling",
      title: "가번호 추첨",
      displayNumber: "1,007",
      showCountdown: true,
      countdownProgress: 50,
      remainingSecondsText: "1.5",
      actionLabel: "지금 추첨",
      actionDisabled: false,
    });

    expect(
      drawViewModel({
        assignment,
        previewNumber: 1007,
        autoDrawEnabled: true,
        remainingMs: 0,
        delaySeconds: 3,
        canAssign: false,
        assigning: false,
      }),
    ).toMatchObject({
      complete: true,
      className: "operator-draw-popover complete",
      title: "추첨 완료",
      displayNumber: "1017",
      showCountdown: false,
    });
  });
});
