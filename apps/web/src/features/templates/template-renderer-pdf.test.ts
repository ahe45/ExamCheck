// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAbortError } from "../../shared/async/bounded-map";
import { downloadTemplatePdf } from "./template-renderer";

const mocks = vi.hoisted(() => ({
  html2canvas: vi.fn(),
  addImage: vi.fn(),
  addPage: vi.fn(),
  save: vi.fn(),
  getWidth: vi.fn(() => 210),
  getHeight: vi.fn(() => 297),
}));

vi.mock("html2canvas", () => ({ default: mocks.html2canvas }));
vi.mock("jspdf", () => ({
  jsPDF: vi.fn(() => ({
    addImage: mocks.addImage,
    addPage: mocks.addPage,
    save: mocks.save,
    internal: { pageSize: { getWidth: mocks.getWidth, getHeight: mocks.getHeight } },
  })),
}));

describe("template PDF renderer deadlines", () => {
  beforeEach(() => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
    mocks.html2canvas.mockResolvedValue(canvas());
  });

  it("times out unresolved page images before rendering or saving", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);

    await expect(
      downloadTemplatePdf("이미지 제한시간", ['<img src="https://invalid.example/photo.png" alt="사진">'], "", {
        imageTimeoutMs: 5,
      }),
    ).rejects.toThrow("양식 이미지를 불러오는 시간이 초과되었습니다.");

    expect(mocks.html2canvas).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(document.querySelector(".generated-pdf-page")).toBeNull();
  });

  it("renders each PDF page with the saved paper, preview styles, margins and page numbering", async () => {
    const html =
      '<div class="template-doc" data-template-page-size="A3" data-template-page-orientation="landscape" data-template-page-margin-top="0" data-template-page-margin-right="5" data-template-page-margin-bottom="10" data-template-page-margin-left="15"><table style="position:absolute;top:700px"><tr><td>서명</td></tr></table></div>';
    const snapshots: Array<{ page: string; css: string; footer: string | null }> = [];
    mocks.html2canvas.mockImplementation(async (page: HTMLElement, options: Record<string, unknown>) => {
      expect(options).toMatchObject({ width: 1587, height: 1123 });
      expect(page.ownerDocument).not.toBe(document);
      expect(page.classList.contains("print-document")).toBe(true);
      snapshots.push({
        page: page.innerHTML,
        css: page.ownerDocument.head.textContent || "",
        footer: page.querySelector(".generated-pdf-page-number")?.textContent || null,
      });
      return canvas();
    });
    await downloadTemplatePdf("두 페이지", [html, html], {
      layout: {
        pages: [
          {
            type: "content",
            settings: {
              documentHtml: html,
              pageNumber: { enabled: true, preset: "numericCurrentTotal", position: "right" },
            },
          },
        ],
      },
    });
    expect(snapshots.map((snapshot) => snapshot.footer)).toEqual(["1/2", "2/2"]);
    expect(snapshots[0].css).toContain("padding: 0px 19px 38px 57px");
    expect(snapshots[0].page).toContain("top:700px");
    expect(mocks.addPage).toHaveBeenCalledWith([(1587 * 25.4) / 96, (1123 * 25.4) / 96], "landscape");
    expect(mocks.addImage).toHaveBeenCalledTimes(2);
    expect(mocks.save).toHaveBeenCalledWith("두 페이지.pdf");
    expect(document.querySelector('iframe[title="PDF 인쇄 준비"]')).toBeNull();
  });

  it("ignores a renderer that completes after the page deadline", async () => {
    let resolveCanvas: ((value: ReturnType<typeof canvas>) => void) | undefined;
    mocks.html2canvas.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCanvas = resolve;
        }),
    );
    const progress = vi.fn();

    await expect(
      downloadTemplatePdf("페이지 제한시간", ["<p>페이지</p>"], "", {
        renderTimeoutMs: 5,
        onProgress: progress,
      }),
    ).rejects.toThrow("PDF 1페이지 렌더링 시간이 초과되었습니다.");

    resolveCanvas?.(canvas());
    await Promise.resolve();
    expect(mocks.addImage).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
    expect(document.querySelector(".generated-pdf-page")).toBeNull();
  });

  it("normalizes abort reasons and prevents late renderer completion from saving", async () => {
    let resolveCanvas: ((value: ReturnType<typeof canvas>) => void) | undefined;
    mocks.html2canvas.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCanvas = resolve;
        }),
    );
    const controller = new AbortController();
    const progress = vi.fn();
    const pending = downloadTemplatePdf("취소", ["<p>페이지</p>"], "", {
      signal: controller.signal,
      renderTimeoutMs: 1_000,
      onProgress: progress,
    });
    await vi.waitFor(() => expect(mocks.html2canvas).toHaveBeenCalledOnce());

    controller.abort("plain cancellation reason");

    await expect(pending).rejects.toSatisfy(isAbortError);
    resolveCanvas?.(canvas());
    await Promise.resolve();
    expect(mocks.addImage).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
    expect(document.querySelector(".generated-pdf-page")).toBeNull();
  });
});

function canvas() {
  return { toDataURL: vi.fn(() => "data:image/jpeg;base64,cGRm") } as unknown as HTMLCanvasElement;
}
