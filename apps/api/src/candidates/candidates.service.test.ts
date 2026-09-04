import ExcelJS from "exceljs";
import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { resolveAppConfig } from "../config/app-config.js";
import { candidateFields, type CandidateInput } from "./candidate-fields.js";
import type { CandidatesApplicationService } from "./candidates.application.js";
import type { CandidatesRepository } from "./candidates.repository.js";
import { CandidatesService } from "./candidates.service.js";

describe("CandidatesService compatibility facade", () => {
  it("builds a workbook with required waiting-room and optional exam-room columns in order", async () => {
    const fixture = createFixture();
    const buffer = await fixture.service.buildTemplate();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const worksheet = workbook.worksheets[0]!;
    const headers = worksheet.getRow(1).values as string[];
    const waitingRoomColumn = candidateFields.findIndex((field) => field.key === "waitingRoom") + 1;
    const roomColumn = candidateFields.findIndex((field) => field.key === "room") + 1;

    expect(headers.slice(1)).toEqual(candidateFields.map((field) => field.label));
    expect(waitingRoomColumn).toBe(candidateFields.findIndex((field) => field.key === "building") + 2);
    expect(roomColumn).toBe(waitingRoomColumn + 1);
    expect(worksheet.getRow(1).getCell(waitingRoomColumn).fill).toMatchObject({
      fgColor: { argb: "FFFFFF00" },
    });
    expect(worksheet.getRow(1).getCell(roomColumn).fill).toMatchObject({
      fgColor: { argb: "FFE2F0D9" },
    });
    expect(worksheet.getRow(2).getCell(waitingRoomColumn).text).toBe("101호 대기실");
    expect(worksheet.getRow(2).getCell(roomColumn).text).toBe("");
  });

  it("builds dashboard statistics from scoped repository aggregates", async () => {
    const fixture = createFixture();
    fixture.repository.listDashboardBreakdownCounts.mockResolvedValue([
      { groupType: "admission", name: "일반전형", total: 3, assigned: 1 },
      { groupType: "admission", name: "특별전형", total: 2, assigned: 2 },
      { groupType: "building", name: "본관", total: 5, assigned: 3 },
      { groupType: "period", name: "1교시 · 2026.09.01 09:00", total: 5, assigned: 3 },
      { groupType: "waitingRoom", name: "본관 · 101호 대기실", total: 5, assigned: 3 },
    ]);

    await expect(
      fixture.service.dashboardSummary({
        id: 7,
        loginId: "operator",
        role: "OPERATOR",
        admissionNames: ["일반전형", "특별전형"],
      }),
    ).resolves.toEqual({
      totalCandidates: 5,
      assignedCandidates: 3,
      unassignedCandidates: 2,
      assignmentRate: 60,
      admissions: [
        {
          name: "일반전형",
          total: 3,
          assigned: 1,
          unassigned: 2,
          assignmentRate: 33.3,
          status: "progress",
        },
        {
          name: "특별전형",
          total: 2,
          assigned: 2,
          unassigned: 0,
          assignmentRate: 100,
          status: "complete",
        },
      ],
      admissionCounts: { waiting: 0, progress: 1, complete: 1 },
      breakdowns: {
        admission: [
          {
            name: "일반전형",
            total: 3,
            assigned: 1,
            unassigned: 2,
            assignmentRate: 33.3,
            status: "progress",
          },
          {
            name: "특별전형",
            total: 2,
            assigned: 2,
            unassigned: 0,
            assignmentRate: 100,
            status: "complete",
          },
        ],
        building: [{ name: "본관", total: 5, assigned: 3, unassigned: 2, assignmentRate: 60, status: "progress" }],
        period: [
          {
            name: "1교시 · 2026.09.01 09:00",
            total: 5,
            assigned: 3,
            unassigned: 2,
            assignmentRate: 60,
            status: "progress",
          },
        ],
        waitingRoom: [
          {
            name: "본관 · 101호 대기실",
            total: 5,
            assigned: 3,
            unassigned: 2,
            assignmentRate: 60,
            status: "progress",
          },
        ],
      },
    });
    expect(fixture.repository.listDashboardBreakdownCounts).toHaveBeenCalledWith(
      fixture.pool,
      {
        sql: "cr.admission IN (?, ?)",
        params: ["일반전형", "특별전형"],
      },
      undefined,
    );
  });

  it("rejects a requested dashboard admission outside the account scope before querying", async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.dashboardSummary(
        { id: 7, loginId: "operator", role: "OPERATOR", admissionNames: ["배정 전형"] },
        "다른 전형",
      ),
    ).rejects.toThrow("배정되지 않은 전형의 대시보드는 조회할 수 없습니다.");
    expect(fixture.repository.listDashboardBreakdownCounts).not.toHaveBeenCalled();
  });

  it("parses the existing workbook format and delegates a checksum and actor to the application layer", async () => {
    const fixture = createFixture();
    const input = candidate({ name: "  홍길동  " });
    const buffer = await workbookBuffer(input);
    fixture.application.importCandidates.mockResolvedValue({ totalRows: 1, inserted: 1, updated: 0, skipped: 0 });

    const preview = await fixture.service.preview(buffer, "수험생 업로드 양식.xlsx", 17);
    expect(preview).toMatchObject({
      fileName: "수험생 업로드 양식.xlsx",
      totalRows: 1,
      insertCount: 1,
      updateCount: 0,
      unchangedCount: 0,
      previewToken: expect.any(String),
    });

    await expect(fixture.service.import(buffer, "insert-update", preview.previewToken, 17)).resolves.toEqual({
      totalRows: 1,
      inserted: 1,
      updated: 0,
      skipped: 0,
    });

    expect(fixture.application.importCandidates).toHaveBeenCalledWith(
      [{ ...input, name: "홍길동" }],
      "insert-update",
      expect.stringMatching(/^[a-f0-9]{64}$/),
      17,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
  });

  it("rejects a preview ticket when another user or another workbook tries to reuse it", async () => {
    const fixture = createFixture();
    const buffer = await workbookBuffer(candidate());
    const preview = await fixture.service.preview(buffer, "upload.xlsx", 17);

    await expect(fixture.service.import(buffer, "all", preview.previewToken, 18)).rejects.toThrow(
      "유효한 미리보기가 필요합니다",
    );
    await expect(
      fixture.service.import(await workbookBuffer(candidate({ name: "다른 파일" })), "all", preview.previewToken, 17),
    ).rejects.toThrow("미리보기 이후 선택한 파일이 변경되었습니다");

    expect(fixture.application.importCandidates).not.toHaveBeenCalled();
  });

  it("rejects an unknown policy before workbook parsing and delegates reads to the repository", async () => {
    const fixture = createFixture();
    fixture.repository.list.mockResolvedValue([]);

    await expect(fixture.service.import(Buffer.alloc(0), "replace" as never, "invalid-ticket", 17)).rejects.toThrow(
      "기존 데이터 처리 방식을 확인해 주세요.",
    );
    await expect(fixture.service.list()).resolves.toEqual([]);
    expect(fixture.repository.list).toHaveBeenCalledWith(fixture.pool);
    expect(fixture.application.importCandidates).not.toHaveBeenCalled();
  });
});

function createFixture() {
  const pool = {} as Pool;
  const repository = {
    list: vi.fn(),
    listDashboardBreakdownCounts: vi.fn(),
    loadExisting: vi.fn().mockResolvedValue(new Map()),
    loadExamineeNumberUniqueness: vi.fn().mockResolvedValue("SYSTEM"),
    listCandidatePhotos: vi.fn().mockResolvedValue([]),
  };
  const application = {
    importCandidates: vi.fn(),
    importCandidatePhotos: vi.fn(),
  };
  const service = new CandidatesService(
    pool,
    repository as unknown as CandidatesRepository,
    application as unknown as CandidatesApplicationService,
    resolveAppConfig({ JWT_SECRET: "candidate-preview-test-secret-that-is-long-enough" }),
  );
  return { application, pool, repository, service };
}

async function workbookBuffer(input: CandidateInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("수험생등록_양식");
  worksheet.addRow(candidateFields.map((field) => field.label));
  worksheet.addRow(candidateFields.map((field) => input[field.key]));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

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
