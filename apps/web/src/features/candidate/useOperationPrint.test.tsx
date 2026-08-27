// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import type { OperationSchedule } from "../../shared/api/examinees";
import type { FormTemplate } from "../../shared/api/form-templates";
import { useOperationPrint } from "./useOperationPrint";

const mocks = vi.hoisted(() => ({
  fetchActiveFormTemplates: vi.fn(),
  buildOperationTemplatePages: vi.fn(),
  downloadTemplatePdf: vi.fn(),
}));

vi.mock("../../shared/api/form-templates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/api/form-templates")>()),
  fetchActiveFormTemplates: mocks.fetchActiveFormTemplates,
}));
vi.mock("./operation-template-pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operation-template-pages")>()),
  buildOperationTemplatePages: mocks.buildOperationTemplatePages,
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
  version: 1,
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
  beforeEach(() => {
    mocks.fetchActiveFormTemplates.mockReset();
    mocks.buildOperationTemplatePages.mockReset();
    mocks.downloadTemplatePdf.mockReset();
    mocks.fetchActiveFormTemplates.mockResolvedValue([template]);
    mocks.downloadTemplatePdf.mockResolvedValue(undefined);
  });

  it("aborts an in-flight PDF generation when the modal is closed", async () => {
    let generationSignal: AbortSignal | undefined;
    mocks.buildOperationTemplatePages.mockImplementation(
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
    mocks.buildOperationTemplatePages.mockImplementation(
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
    mocks.buildOperationTemplatePages.mockImplementation(
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
    await waitFor(() => expect(mocks.buildOperationTemplatePages).toHaveBeenCalledOnce());
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
    mocks.buildOperationTemplatePages.mockResolvedValue(["<p>page</p>"]);
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
    mocks.buildOperationTemplatePages.mockImplementation(
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
    await waitFor(() => expect(mocks.buildOperationTemplatePages).toHaveBeenCalledOnce());
    unmount();
    finishPages?.(["<p>late page</p>"]);
    await generation;

    expect(generationSignal?.aborted).toBe(true);
    expect(mocks.downloadTemplatePdf).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "success" }));
  });
});
