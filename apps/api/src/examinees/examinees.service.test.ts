import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { resolveAppConfig } from "../config/app-config.js";
import { ExamineesService } from "./examinees.service.js";

const restrictedUser: AuthenticatedUser = {
  id: 7,
  loginId: "operator",
  role: "OPERATOR",
  admissionNames: ["  Ａ전형  "],
};

describe("ExamineesService admission authorization", () => {
  it("uses the centralized placeholder predicate for the schedule list", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const service = createService(execute);

    await service.listSchedules(restrictedUser);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][0]).toContain("WHERE cr.admission IN (?)");
    expect(execute.mock.calls[0][1]).toEqual(["A전형"]);
  });

  it("allows an NFKC-equivalent assigned admission in a roster scope", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const service = createService(execute);

    await expect(
      service.listRoster(
        {
          date: "2026-08-11",
          time: "09:00",
          periodName: "1교시",
          admissionName: "  Ａ전형  ",
        },
        restrictedUser,
      ),
    ).resolves.toEqual([]);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][1]).toEqual(["2026-08-11", "09:00", "1교시", "A전형"]);
  });

  it("rejects a roster outside the assigned admissions before querying the database", async () => {
    const execute = vi.fn();
    const service = createService(execute);

    await expect(
      service.listRoster(
        {
          date: "2026-08-11",
          time: "09:00",
          periodName: "1교시",
          admissionName: "다른 전형",
        },
        restrictedUser,
      ),
    ).rejects.toThrow("배정되지 않은 전형의 데이터");
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns schedule-specific candidate fields and the configured exam context", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          id: 202,
          examineeNo: "10001",
          name: "일정별 수험생",
          birthDate: "2000-01-01",
          examDate: "2026-08-11",
          examTime: "13:00",
          examEndTime: "",
          periodName: "2교시",
          periodCode: "",
          admissionName: "A전형",
          admissionCode: "",
          unitName: "디자인",
          unitCode: "",
          majorName: "시각디자인",
          majorCode: "",
          buildingName: "예술관",
          buildingCode: "",
          roomName: "202호",
          roomCode: "",
          seatNo: "22",
          groupName: "",
          labelBarcode: "EX10001",
          preassignedNumber: "2201",
          preassignedAvailable: 1,
          assignedNumber: "2201",
          assignmentMode: "PREASSIGNED",
          assignedAt: null,
          absent: 0,
          status: "ACTIVE",
          opt1: "",
          opt2: "",
          opt3: "",
          examName: "오래된 레거시 시험명",
        },
      ],
      [],
    ]);
    const service = createService(execute, "현재 운영 시험");

    const result = await service.findActiveByNumber(
      "10001",
      { date: "2026-08-11", time: "13:00", periodName: "2교시", admissionName: "A전형" },
      restrictedUser,
    );

    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toContain("SELECT cr.id");
    expect(sql).toContain("cr.name");
    expect(sql).toContain("DATE_FORMAT(cr.birth_date");
    expect(sql).toContain("cr.room_name AS roomName");
    expect(sql).toContain("COALESCE(cr.designated_sort");
    expect(sql).toContain("NULLIF(cr.temporary_no");
    expect(sql).toContain("COALESCE(pa.pseudonym_no, NULLIF(cr.temporary_no, '')) AS assignedNumber");
    expect(sql).not.toContain("e.name");
    expect(sql).not.toContain("e.exam_date");
    expect(sql).not.toContain("e.room_name");
    expect(result).toMatchObject({
      id: 202,
      name: "일정별 수험생",
      birthDate: "2000-01-01",
      examName: "현재 운영 시험",
      roomName: "202호",
      seatNo: "22",
      preassignedNumber: "2201",
      preassignedAvailable: true,
      assignedNumber: "2201",
      assignmentMode: "PREASSIGNED",
    });
  });
});

function createService(execute: ReturnType<typeof vi.fn>, examName = "2026년도 자격시험") {
  return new ExamineesService({ execute } as unknown as Pool, resolveAppConfig({ DEFAULT_EXAM_NAME: examName }));
}
