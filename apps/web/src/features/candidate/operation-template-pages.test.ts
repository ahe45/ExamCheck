// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import type { Examinee, OperationSchedule } from "../../shared/api/examinees";
import type { FormTemplate } from "../../shared/api/form-templates";
import { isAbortError } from "../../shared/async/bounded-map";
import { buildOperationTemplatePages, createOperationTemplatePages } from "./operation-template-pages";
import type { OperationRow } from "./operation-view-model";

const mocks = vi.hoisted(() => ({
  fetchExamineePhoto: vi.fn(),
  getTemplateDocumentHtml: vi.fn(),
  renderTemplateHtml: vi.fn(),
}));

vi.mock("../../shared/api/examinees", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/api/examinees")>()),
  fetchExamineePhoto: mocks.fetchExamineePhoto,
}));

vi.mock("../templates/template-renderer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../templates/template-renderer")>()),
  getTemplateDocumentHtml: mocks.getTemplateDocumentHtml,
  renderTemplateHtml: mocks.renderTemplateHtml,
}));

const schedule: OperationSchedule = {
  date: "2026-10-30",
  time: "10:00",
  periodName: "오전",
  admissionName: "학생부교과 면접",
  buildingNames: ["본관"],
  candidateCount: 9,
  assignedCount: 0,
  printedCount: 0,
  labelPrintingEnabled: false,
};

const systemProfile: DeveloperSettings = {
  schoolName: "한국대학교",
  academicYear: 2026,
  systemName: "가번호 관리 시스템",
  examineeNoUniqueness: "SYSTEM",
  pseudonymNoUniqueness: "ADMISSION",
  logoFileName: null,
  logoDataUrl: null,
  updatedAt: "2026-08-28T00:00:00.000Z",
};

describe("buildOperationTemplatePages", () => {
  beforeEach(() => {
    mocks.getTemplateDocumentHtml.mockReturnValue('<img data-template-tag-value="candidate.photo">');
    mocks.renderTemplateHtml.mockImplementation((_layout: unknown, values: Record<string, unknown>) =>
      String(values["candidate.examNo"]),
    );
  });

  it("does not fetch photos or render other pages before the PDF consumer requests them", async () => {
    mocks.fetchExamineePhoto.mockResolvedValue(new Blob(["photo"], { type: "image/png" }));
    const pages = createOperationTemplatePages(
      candidateTemplate(),
      Array.from({ length: 1000 }, (_, i) => operationRow(i + 1)),
      { token: "token", systemProfile, schedule, examName: "시험", operationClosed: false },
    );
    expect(pages.length).toBe(1000);
    expect(mocks.fetchExamineePhoto).not.toHaveBeenCalled();
    await pages.getPage(0);
    expect(mocks.fetchExamineePhoto).toHaveBeenCalledTimes(1);
    expect(mocks.renderTemplateHtml).toHaveBeenCalledTimes(1);
  });

  it("loads candidate photos with at most four requests and preserves page order", async () => {
    const controller = new AbortController();
    let active = 0;
    let peak = 0;
    mocks.fetchExamineePhoto.mockImplementation(
      async (_examineeNo: string, _token: string, _schedule: OperationSchedule, signal?: AbortSignal) => {
        expect(signal).toBe(controller.signal);
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 8));
        active -= 1;
        return new Blob(["photo"], { type: "image/png" });
      },
    );
    const progress = vi.fn();
    const rows = Array.from({ length: 9 }, (_, index) => operationRow(index + 1));

    await expect(
      buildOperationTemplatePages(candidateTemplate(), rows, {
        token: "token",
        systemProfile,
        schedule,
        examName: "2026년도 자격시험",
        operationClosed: false,
        signal: controller.signal,
        onPhotoProgress: progress,
      }),
    ).resolves.toEqual(rows.map((row) => row.candidate.examineeNo));

    expect(peak).toBe(4);
    expect(mocks.fetchExamineePhoto).toHaveBeenCalledTimes(9);
    expect(progress).toHaveBeenLastCalledWith(9, 9);
  });

  it("forwards cancellation to all active photo requests and does not render late pages", async () => {
    const controller = new AbortController();
    mocks.fetchExamineePhoto.mockImplementation(
      (_examineeNo: string, _token: string, _schedule: OperationSchedule, signal?: AbortSignal) =>
        new Promise<Blob>((_resolve, reject) => {
          expect(signal).toBe(controller.signal);
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const progress = vi.fn();
    const pending = buildOperationTemplatePages(
      candidateTemplate(),
      Array.from({ length: 8 }, (_, index) => operationRow(index + 1)),
      {
        token: "token",
        systemProfile,
        schedule,
        examName: "2026년도 자격시험",
        operationClosed: false,
        signal: controller.signal,
        onPhotoProgress: progress,
      },
    );
    await vi.waitFor(() => expect(mocks.fetchExamineePhoto).toHaveBeenCalledTimes(4));

    controller.abort(new DOMException("사용자 취소", "AbortError"));

    await expect(pending).rejects.toSatisfy(isAbortError);
    expect(mocks.fetchExamineePhoto).toHaveBeenCalledTimes(4);
    expect(mocks.renderTemplateHtml).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it("honors an already-aborted signal for non-candidate templates", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("사용자 취소", "AbortError"));

    await expect(
      buildOperationTemplatePages({ ...candidateTemplate(), usageScope: "ROOM" }, [operationRow(1)], {
        token: "token",
        systemProfile,
        schedule,
        examName: "2026년도 자격시험",
        operationClosed: false,
        signal: controller.signal,
      }),
    ).rejects.toSatisfy(isAbortError);
    expect(mocks.renderTemplateHtml).not.toHaveBeenCalled();
  });

  it("projects entered author and reviewer names into every rendered page", async () => {
    mocks.getTemplateDocumentHtml.mockReturnValue("<p></p>");
    mocks.renderTemplateHtml.mockImplementation(
      (_layout: unknown, values: Record<string, unknown>) =>
        `${values["signature.author"]}/${values["signature.reviewer"]}`,
    );

    await expect(
      buildOperationTemplatePages(candidateTemplate(), [operationRow(1)], {
        token: "token",
        systemProfile,
        schedule,
        examName: "2026년도 자격시험",
        operationClosed: true,
        signatureNames: { "signature.author": "김작성", "signature.reviewer": "이확인" },
      }),
    ).resolves.toEqual(["김작성/이확인"]);
  });

  it("수험생별 대기실명을 실제 문서에 출력하고 빈 값은 예시로 대체하지 않는다", async () => {
    const renderer = await vi.importActual<typeof import("../templates/template-renderer")>(
      "../templates/template-renderer",
    );
    const html = '<p><span data-template-tag-value="candidate.waitingRoomName">101호 대기실</span></p>';
    mocks.getTemplateDocumentHtml.mockReturnValue(html);
    mocks.renderTemplateHtml.mockImplementation(renderer.renderTemplateHtml);
    const rows = [operationRow(1), operationRow(2), operationRow(3)];
    rows[0].candidate.waitingRoom = "본관 201호";
    rows[1].candidate.waitingRoom = "별관 <202호>";
    rows[2].candidate.waitingRoom = "";
    const pages = await buildOperationTemplatePages({ ...candidateTemplate(), layout: { documentHtml: html } }, rows, {
      token: "token",
      systemProfile,
      schedule,
      examName: "시험",
      operationClosed: false,
    });
    expect(pages.map((page) => new DOMParser().parseFromString(page, "text/html").body.textContent)).toEqual([
      "본관 201호",
      "별관 <202호>",
      "",
    ]);
    expect(pages[1]).toContain("&lt;202호&gt;");
  });
});

function candidateTemplate(): FormTemplate {
  return {
    id: 1,
    code: "CANDIDATE_CARD",
    name: "수험생 확인표",
    description: null,
    category: "운영",
    usageScope: "CANDIDATE",
    layout: { pages: [] },
    active: true,
    createdAt: "2026-08-28T00:00:00.000Z",
    createdByLoginId: "admin",
  };
}

function operationRow(index: number): OperationRow {
  const examineeNo = String(10000 + index);
  const candidate: Examinee = {
    id: index,
    examineeNo,
    name: `수험생 ${index}`,
    birthDate: "2000-01-01",
    examName: "2026년도 자격시험",
    examDate: schedule.date,
    roomName: "101호",
    waitingRoom: "201호 대기실",
    seatNo: String(index),
    labelBarcode: `EX${examineeNo}`,
    preassignedNumber: null,
    preassignedAvailable: false,
    assignedNumber: null,
    assignmentMode: null,
    assignedAt: null,
    status: "ACTIVE",
    examTime: schedule.time,
    examEndTime: "",
    periodName: schedule.periodName,
    periodCode: "",
    admissionName: schedule.admissionName,
    admissionCode: "",
    unitName: "모집단위",
    unitCode: "",
    majorName: "전공",
    majorCode: "",
    buildingName: "본관",
    buildingCode: "",
    roomCode: "",
    groupName: "",
    opt1: "",
    opt2: "",
    opt3: "",
    absent: false,
  };
  return { candidate, assignment: null };
}
