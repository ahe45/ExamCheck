// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import type { OperationSchedule } from "../../shared/api/examinees";
import type { FormTemplate } from "../../shared/api/form-templates";
import { useOperationPrint } from "./useOperationPrint";
import type { OperationRow } from "./operation-view-model";

const mocks = vi.hoisted(() => ({
  fetchActiveFormTemplates: vi.fn(),
  createOperationTemplatePages: vi.fn(),
  downloadTemplatePdf: vi.fn(),
}));

vi.mock("../../shared/api/form-templates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/api/form-templates")>()),
  fetchActiveFormTemplates: mocks.fetchActiveFormTemplates,
  fetchFormTemplate: async (...args: unknown[]) =>
    (await mocks.fetchActiveFormTemplates(args[0])).find((item: FormTemplate) => item.code === args[1]),
}));
vi.mock("./operation-template-pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operation-template-pages")>()),
  createOperationTemplatePages: mocks.createOperationTemplatePages,
}));
vi.mock("../templates/template-renderer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../templates/template-renderer")>()),
  downloadTemplatePdf: mocks.downloadTemplatePdf,
}));

const schedule: OperationSchedule = {
  date: "2026-10-30",
  time: "10:00",
  periodName: "오전",
  admissionName: "학생부교과 면접",
  buildingNames: ["본관"],
  candidateCount: 1,
  assignedCount: 1,
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
const template: FormTemplate = {
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

describe("useOperationPrint", () => {
  it("forwards the target through signature confirmation and resets it when reopened", async () => {
    const signed = {
      ...template,
      layout: {
        settings: {
          documentHtml: '<span data-template-tag-value="signature.author"></span>',
          signatureNames: { enabled: true },
        },
      },
    };
    mocks.fetchActiveFormTemplates.mockResolvedValue([signed]);
    mocks.createOperationTemplatePages.mockResolvedValue(["<p>출력</p>"]);
    const rows = [
      { candidate: { absent: false, lastPrintedAt: "2026-10-30T01:00:00Z" }, assignment: { pseudonymNumber: "1" } },
    ] as OperationRow[];
    const { result } = renderHook(() =>
      useOperationPrint({
        token: "test",
        systemProfile,
        schedule,
        scheduleKey: "schedule-1",
        examName: "시험",
        rows,
        statusLoaded: true,
        operationClosed: true,
        labelPrintingEnabled: true,
        isCurrentSchedule: () => true,
        onNotice: vi.fn(),
      }),
    );
    await act(async () => result.current.show());
    expect(result.current.printTarget).toBe("ALL");
    act(() => result.current.setPrintTarget("PRESENT"));
    await act(async () => result.current.generate());
    expect(result.current.signatureOpen).toBe(true);
    act(() => result.current.updateSignatureName("signature.author", "작성자"));
    await act(async () => result.current.confirmSignatures());
    expect(mocks.createOperationTemplatePages).toHaveBeenCalledWith(
      signed,
      rows,
      expect.objectContaining({ printTarget: "PRESENT", labelPrintingEnabled: true }),
    );
    await act(async () => result.current.show());
    expect(result.current.printTarget).toBe("ALL");
  });

  it("rejects present-only printing when preassigned candidates have not printed their labels", async () => {
    const onNotice = vi.fn();
    const { result } = renderHook(() =>
      useOperationPrint({
        token: "test",
        systemProfile,
        schedule,
        scheduleKey: "schedule-1",
        examName: "시험",
        rows: [{ candidate: { absent: false }, assignment: { pseudonymNumber: "1" } }] as OperationRow[],
        statusLoaded: true,
        operationClosed: true,
        labelPrintingEnabled: true,
        isCurrentSchedule: () => true,
        onNotice,
      }),
    );
    await act(async () => result.current.show());
    act(() => result.current.setPrintTarget("PRESENT"));
    expect(result.current.totalCount).toBe(1);
    expect(result.current.presentCount).toBe(0);
    await act(async () => result.current.generate());
    expect(mocks.createOperationTemplatePages).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenLastCalledWith({ kind: "error", text: "응시한 수험생이 없어 출력할 수 없습니다." });
  });

  beforeEach(() => {
    mocks.fetchActiveFormTemplates.mockReset();
    mocks.createOperationTemplatePages.mockReset();
    mocks.downloadTemplatePdf.mockReset();
    mocks.fetchActiveFormTemplates.mockResolvedValue([template]);
    mocks.downloadTemplatePdf.mockResolvedValue(undefined);
  });

  it("출력 양식 목록에서 미사용 양식을 제외한다", async () => {
    mocks.fetchActiveFormTemplates.mockResolvedValue([
      { ...template, id: 2, code: "DISABLED_CARD", name: "미사용 양식", active: false },
      template,
    ]);
    const { result } = renderHook(() =>
      useOperationPrint({
        token: "token",
        systemProfile,
        examName: "2026년도 자격시험",
        schedule,
        scheduleKey: "schedule-1",
        rows: [],
        statusLoaded: true,
        operationClosed: true,
        isCurrentSchedule: () => true,
        onNotice: vi.fn(),
      }),
    );

    await act(async () => result.current.show());

    expect(result.current.templates).toEqual([template]);
    expect(result.current.selectedTemplateCode).toBe(template.code);
  });

  it("requires and forwards only signer names configured by tags used in the template", async () => {
    const signatureTemplate: FormTemplate = {
      ...template,
      layout: {
        layout: {
          pages: [
            {
              settings: {
                documentHtml:
                  '<span data-template-tag-value="signature.author"></span><span data-template-tag-value="signature.reviewer"></span>',
                signatureNames: { enabled: true },
              },
            },
          ],
        },
      },
    };
    mocks.fetchActiveFormTemplates.mockResolvedValue([signatureTemplate]);
    mocks.createOperationTemplatePages.mockResolvedValue(["<p>page</p>"]);
    const onNotice = vi.fn();
    const { result } = renderHook(() =>
      useOperationPrint({
        token: "token",
        systemProfile,
        examName: "2026년도 자격시험",
        schedule,
        scheduleKey: "schedule-1",
        rows: [],
        statusLoaded: true,
        operationClosed: true,
        isCurrentSchedule: () => true,
        onNotice,
      }),
    );

    await act(async () => result.current.show());
    expect(result.current.signatureFields.map((field) => field.label)).toEqual(["작성자", "확인자"]);
    expect(result.current.signatureOpen).toBe(false);
    await act(async () => result.current.generate());
    expect(mocks.createOperationTemplatePages).not.toHaveBeenCalled();
    expect(result.current.signatureOpen).toBe(true);
    expect(result.current.signatureError).toBeNull();
    act(() => result.current.closeSignatures());
    expect(result.current.open).toBe(true);
    expect(result.current.signatureOpen).toBe(false);
    await act(async () => result.current.confirmSignatures());
    expect(mocks.createOperationTemplatePages).not.toHaveBeenCalled();
    await act(async () => result.current.generate());
    await act(async () => result.current.confirmSignatures());
    expect(result.current.signatureError).toBe("작성자 이름을 입력해 주세요.");

    act(() => {
      result.current.updateSignatureName("signature.author", " 김작성 ");
      result.current.updateSignatureName("signature.reviewer", " 이확인 ");
    });
    await act(async () => result.current.confirmSignatures());

    expect(mocks.createOperationTemplatePages).toHaveBeenCalledWith(
      signatureTemplate,
      [],
      expect.objectContaining({
        signatureNames: { "signature.author": "김작성", "signature.reviewer": "이확인" },
      }),
    );
    expect(result.current.signatureOpen).toBe(false);
    expect(result.current.open).toBe(false);
  });

  it("aborts an in-flight PDF generation when the modal is closed", async () => {
    let generationSignal: AbortSignal | undefined;
    mocks.createOperationTemplatePages.mockImplementation(
      (_template: FormTemplate, _rows: unknown[], context: { signal?: AbortSignal }) => {
        generationSignal = context.signal;
        return new Promise<string[]>((_resolve, reject) => {
          context.signal?.addEventListener(
            "abort",
            () => reject(context.signal?.reason ?? new DOMException("취소", "AbortError")),
            { once: true },
          );
        });
      },
    );
    const onNotice = vi.fn();
    const { result } = renderHook(() =>
      useOperationPrint({
        token: "token",
        systemProfile,
        examName: "2026년도 자격시험",
        schedule,
        scheduleKey: "schedule-1",
        rows: [],
        statusLoaded: true,
        operationClosed: true,
        isCurrentSchedule: () => true,
        onNotice,
      }),
    );

    await act(async () => result.current.show());
    expect(result.current.open).toBe(true);

    let generation!: Promise<void>;
    act(() => {
      generation = result.current.generate();
    });
    await waitFor(() => expect(result.current.generating).toBe(true));
    act(() => result.current.close());
    await act(async () => generation);

    expect(generationSignal?.aborted).toBe(true);
    expect(result.current.open).toBe(false);
    expect(result.current.generating).toBe(false);
    expect(mocks.downloadTemplatePdf).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "error" }));
  });

  it("reports page progress and closes after a successful PDF", async () => {
    mocks.createOperationTemplatePages.mockImplementation(
      async (
        _template: FormTemplate,
        _rows: unknown[],
        context: { onPhotoProgress?: (done: number, total: number) => void },
      ) => {
        context.onPhotoProgress?.(1, 1);
        return ["<p>1</p>", "<p>2</p>"];
      },
    );
    mocks.downloadTemplatePdf.mockImplementation(
      async (
        _title: string,
        _pages: string[],
        _layout: unknown,
        options: { onProgress?: (done: number, total: number) => void },
      ) => {
        options.onProgress?.(1, 2);
        options.onProgress?.(2, 2);
      },
    );
    const onNotice = vi.fn();
    const { result } = renderHook(() =>
      useOperationPrint({
        token: "token",
        systemProfile,
        examName: "2026년도 자격시험",
        schedule,
        scheduleKey: "schedule-1",
        rows: [],
        statusLoaded: true,
        operationClosed: true,
        isCurrentSchedule: () => true,
        onNotice,
      }),
    );

    await act(async () => result.current.show());
    await act(async () => result.current.generate());

    expect(result.current.open).toBe(false);
    expect(result.current.progress).toBeNull();
    expect(onNotice).toHaveBeenLastCalledWith({
      kind: "success",
      text: "수험생 확인표 양식으로 PDF 2페이지를 생성했습니다.",
    });
  });

  it("does not start rendering or notify when page preparation completes after cancellation", async () => {
    let finishPages: ((pages: string[]) => void) | undefined;
    mocks.createOperationTemplatePages.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          finishPages = resolve;
        }),
    );
    const onNotice = vi.fn();
    const { result } = renderHook(() =>
      useOperationPrint({
        token: "token",
        systemProfile,
        examName: "2026년도 자격시험",
        schedule,
        scheduleKey: "schedule-1",
        rows: [],
        statusLoaded: true,
        operationClosed: true,
        isCurrentSchedule: () => true,
        onNotice,
      }),
    );
    await act(async () => result.current.show());

    let generation!: Promise<void>;
    act(() => {
      generation = result.current.generate();
    });
    await waitFor(() => expect(mocks.createOperationTemplatePages).toHaveBeenCalledOnce());
    act(() => result.current.close());
    await act(async () => {
      finishPages?.(["<p>late page</p>"]);
      await generation;
    });

    expect(mocks.downloadTemplatePdf).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "success" }));
    expect(result.current.open).toBe(false);
  });

  it("does not show a success notice when PDF rendering completes after cancellation", async () => {
    mocks.createOperationTemplatePages.mockResolvedValue(["<p>page</p>"]);
    let finishDownload: (() => void) | undefined;
    mocks.downloadTemplatePdf.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDownload = resolve;
        }),
    );
    const onNotice = vi.fn();
    const { result } = renderHook(() =>
      useOperationPrint({
        token: "token",
        systemProfile,
        examName: "2026년도 자격시험",
        schedule,
        scheduleKey: "schedule-1",
        rows: [],
        statusLoaded: true,
        operationClosed: true,
        isCurrentSchedule: () => true,
        onNotice,
      }),
    );
    await act(async () => result.current.show());

    let generation!: Promise<void>;
    act(() => {
      generation = result.current.generate();
    });
    await waitFor(() => expect(mocks.downloadTemplatePdf).toHaveBeenCalledOnce());
    act(() => result.current.close());
    await act(async () => {
      finishDownload?.();
      await generation;
    });

    expect(onNotice).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "success" }));
    expect(result.current.open).toBe(false);
    expect(result.current.generating).toBe(false);
  });

  it("aborts and ignores late page preparation after the operation screen unmounts", async () => {
    let generationSignal: AbortSignal | undefined;
    let finishPages: ((pages: string[]) => void) | undefined;
    mocks.createOperationTemplatePages.mockImplementation(
      (_template: FormTemplate, _rows: unknown[], context: { signal?: AbortSignal }) => {
        generationSignal = context.signal;
        return new Promise<string[]>((resolve) => {
          finishPages = resolve;
        });
      },
    );
    const onNotice = vi.fn();
    const { result, unmount } = renderHook(() =>
      useOperationPrint({
        token: "token",
        systemProfile,
        examName: "2026년도 자격시험",
        schedule,
        scheduleKey: "schedule-1",
        rows: [],
        statusLoaded: true,
        operationClosed: true,
        isCurrentSchedule: () => true,
        onNotice,
      }),
    );
    await act(async () => result.current.show());

    let generation!: Promise<void>;
    act(() => {
      generation = result.current.generate();
    });
    await waitFor(() => expect(mocks.createOperationTemplatePages).toHaveBeenCalledOnce());
    unmount();
    finishPages?.(["<p>late page</p>"]);
    await generation;

    expect(generationSignal?.aborted).toBe(true);
    expect(mocks.downloadTemplatePdf).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "success" }));
  });
});
