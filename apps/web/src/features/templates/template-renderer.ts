import DOMPurify from "dompurify";
import type { TemplateEditorValue } from "../../shared/templates/template-editor-contracts";
import { throwIfAborted } from "../../shared/async/bounded-map";
import { formatProjectDataTagSampleValue } from "./editor/examlist-template-formatting";

export function getTemplateDocumentHtml(template: TemplateEditorValue): string {
  if (typeof template === "string") return template;
  type PrintablePage = { type?: string; settings?: { documentHtml?: string } };
  const nestedPages = template.layout?.pages as PrintablePage[] | undefined;
  const topLevelPages = (template as { pages?: PrintablePage[] }).pages;
  const pages: PrintablePage[] = Array.isArray(nestedPages)
    ? nestedPages
    : Array.isArray(topLevelPages)
      ? topLevelPages
      : [];
  const contentPage =
    pages.find((page) => page.type === "content" && page.settings?.documentHtml) ??
    pages.find((page) => page.settings?.documentHtml);
  return (
    contentPage?.settings?.documentHtml ??
    template.documentHtml ??
    template.html ??
    template.settings?.documentHtml ??
    ""
  );
}

export function renderTemplateHtml(template: TemplateEditorValue, values: Record<string, unknown>): string {
  const source = sanitizeTemplateHtml(
    getTemplateDocumentHtml(template).replace(/{{\s*([\w.]+)\s*}}/g, (_match, key: string) => escapeHtml(values[key])),
  );
  const document = new DOMParser().parseFromString(`<div id="form-template-root">${source}</div>`, "text/html");
  const root = document.getElementById("form-template-root");
  if (!root) return source;

  root.querySelectorAll<HTMLElement>("[data-template-tag-value]").forEach((element) => {
    const key = element.dataset.templateTagValue || "";
    const rawValue = values[key] ?? "";
    if (element instanceof HTMLImageElement && key === "candidate.photo") {
      element.src = String(rawValue || "");
      element.alt = String(values["candidate.name"] || "수험생 사진");
      return;
    }
    const format = element.dataset.templateTagFormat || "";
    const formatType = element.dataset.templateTagFormatType || "";
    element.textContent = format
      ? formatProjectDataTagSampleValue({ key, type: formatType }, rawValue, format, formatType)
      : String(rawValue ?? "");
  });

  root.querySelectorAll<HTMLImageElement>("img.template-generated-object").forEach((image) => {
    const sourceKey = image.dataset.templateObjectSource || "candidate.examNo";
    const value = String(values[sourceKey] ?? "");
    image.removeAttribute("src");
    image.alt = `${value || sourceKey} ${image.dataset.templateObjectType === "qrcode" ? "QR코드" : "바코드"}`;
    image.dataset.renderPending = "true";
  });
  return sanitizeTemplateHtml(root.innerHTML);
}

export function openTemplatePrintWindow(title: string, bodyHtml: string) {
  const printWindow = window.open("", "_blank", "width=1000,height=800");
  if (!printWindow) throw new Error("팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.");
  printWindow.opener = null;
  printWindow.document.open();
  printWindow.document.write(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{size:A4;margin:10mm}*{box-sizing:border-box}body{margin:0;color:#111827;font-family:"Noto Sans KR",Arial,sans-serif}.print-toolbar{position:sticky;top:0;display:flex;justify-content:flex-end;gap:8px;padding:10px;background:#edf2f7;border-bottom:1px solid #cbd5e1}.print-toolbar button{border:0;border-radius:8px;padding:9px 14px;color:white;background:#176b5f;font-weight:700;cursor:pointer}.print-document{width:210mm;min-height:297mm;margin:0 auto;padding:10mm;background:white}.template-generated-object[data-render-pending="true"]{display:inline-grid;place-items:center;min-width:120px;min-height:54px;border:1px dashed #94a3b8;font-size:11px}@media print{.print-toolbar{display:none}.print-document{width:auto;min-height:0;margin:0;padding:0}}</style></head><body><div class="print-toolbar"><button onclick="window.print()">인쇄</button></div><main class="print-document">${sanitizeTemplateHtml(bodyHtml)}</main></body></html>`,
  );
  printWindow.document.close();
}

export interface PdfGenerationOptions {
  signal?: AbortSignal;
  imageTimeoutMs?: number;
  renderTimeoutMs?: number;
  onProgress?(completed: number, total: number): void;
}

export async function downloadTemplatePdf(
  title: string,
  pagesHtml: string[],
  template: TemplateEditorValue,
  options: PdfGenerationOptions = {},
) {
  if (!pagesHtml.length) throw new Error("PDF로 생성할 데이터가 없습니다.");
  throwIfAborted(options.signal);
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  throwIfAborted(options.signal);
  const orientation = templateOrientation(template);
  const pageWidth = orientation === "landscape" ? 1123 : 794;
  const pageHeight = orientation === "landscape" ? 794 : 1123;
  const stage = document.createElement("div");
  stage.setAttribute("aria-hidden", "true");
  Object.assign(stage.style, {
    position: "fixed",
    left: "-20000px",
    top: "0",
    width: `${pageWidth}px`,
    background: "#fff",
    zIndex: "-1",
  });
  document.body.append(stage);
  const pdf = new jsPDF({ orientation, unit: "mm", format: "a4", compress: true });
  try {
    await withDeadline(document.fonts.ready, 15_000, "PDF 글꼴 준비 시간이 초과되었습니다.", options.signal);
    for (let index = 0; index < pagesHtml.length; index += 1) {
      throwIfAborted(options.signal);
      const page = document.createElement("section");
      page.className = "generated-pdf-page";
      Object.assign(page.style, {
        boxSizing: "border-box",
        width: `${pageWidth}px`,
        minHeight: `${pageHeight}px`,
        padding: "38px",
        overflow: "hidden",
        color: "#111827",
        background: "#fff",
        fontFamily: '"Noto Sans KR", Arial, sans-serif',
      });
      page.innerHTML = sanitizeTemplateHtml(pagesHtml[index]);
      stage.replaceChildren(page);
      await waitForImages(page, options.imageTimeoutMs ?? 15_000, options.signal);
      const canvas = await withDeadline(
        html2canvas(page, {
          backgroundColor: "#ffffff",
          scale: 1.35,
          useCORS: true,
          logging: false,
        }),
        options.renderTimeoutMs ?? 30_000,
        `PDF ${index + 1}페이지 렌더링 시간이 초과되었습니다.`,
        options.signal,
      );
      throwIfAborted(options.signal);
      if (index > 0) pdf.addPage("a4", orientation);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pdfWidth, pdfHeight, undefined, "FAST");
      options.onProgress?.(index + 1, pagesHtml.length);
    }
    throwIfAborted(options.signal);
    pdf.save(`${safeFileName(title)}.pdf`);
  } finally {
    stage.remove();
  }
}

function templateOrientation(template: TemplateEditorValue): "portrait" | "landscape" {
  if (typeof template === "string") return "portrait";
  const raw = String(template.orientation || template.settings?.orientation || "portrait").toLowerCase();
  return raw === "landscape" ? "landscape" : "portrait";
}

async function waitForImages(root: HTMLElement, timeoutMs: number, signal?: AbortSignal) {
  const pending = Array.from(root.querySelectorAll("img")).filter((image) => !image.complete);
  if (!pending.length) return;
  const cleanups: Array<() => void> = [];
  const imagesReady = Promise.all(
    pending.map(
      (image) =>
        new Promise<void>((resolve) => {
          const complete = () => resolve();
          image.addEventListener("load", complete, { once: true });
          image.addEventListener("error", complete, { once: true });
          cleanups.push(() => {
            image.removeEventListener("load", complete);
            image.removeEventListener("error", complete);
          });
        }),
    ),
  ).then(() => undefined);
  try {
    await withDeadline(imagesReady, timeoutMs, "양식 이미지를 불러오는 시간이 초과되었습니다.", signal);
  } finally {
    cleanups.forEach((cleanup) => cleanup());
  }
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string, signal?: AbortSignal) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error("작업 제한 시간은 양수여야 합니다."));
  }
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () =>
      finish(() => {
        try {
          throwIfAborted(signal);
        } catch (reason) {
          reject(reason);
        }
      });
    const timeoutId = globalThis.setTimeout(() => finish(() => reject(new Error(timeoutMessage))), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (reason: unknown) => finish(() => reject(reason)),
    );
  });
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").trim() || "가번호_출력";
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] || character,
  );
}

export function sanitizeTemplateHtml(value: string): string {
  return DOMPurify.sanitize(value, {
    ALLOW_DATA_ATTR: true,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "meta", "base", "link", "form"],
    FORBID_ATTR: ["srcdoc", "formaction"],
  });
}
