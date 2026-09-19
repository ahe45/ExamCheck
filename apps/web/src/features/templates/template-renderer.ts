import DOMPurify from "dompurify";
import { getTemplatePrintPresentation, templatePrintTokenFlowCss } from "./template-print-presentation";
import { joinFullSizePrintTables } from "./editor/template-table-joining";
import { embedLoadedPrintFonts } from "./template-print-fonts";
import type { TemplateEditorPageSettings, TemplateEditorValue } from "../../shared/templates/template-editor-contracts";
import { throwIfAborted } from "../../shared/async/bounded-map";
import { formatProjectDataTagSampleValue } from "./editor/examlist-template-formatting";
import { createTemplateGeneratedObjectDataUrl } from "./generated-object-assets";
import { normalizeTemplateDataTagKey, resolveTemplateDataTagValue } from "./template-data-projection";

function getTemplateContentPage(template: TemplateEditorValue) {
  if (typeof template === "string") return undefined;
  type PrintablePage = { type?: string; settings?: TemplateEditorPageSettings };
  const nestedPages = template.layout?.pages as PrintablePage[] | undefined;
  const topLevelPages = (template as { pages?: PrintablePage[] }).pages;
  const pages: PrintablePage[] = Array.isArray(nestedPages)
    ? nestedPages
    : Array.isArray(topLevelPages)
      ? topLevelPages
      : [];
  return (
    pages.find((page) => page.type === "content" && page.settings?.documentHtml) ??
    pages.find((page) => page.settings?.documentHtml)
  );
}

export function getTemplatePageSettings(template: TemplateEditorValue): TemplateEditorPageSettings {
  if (typeof template === "string") return {};
  return getTemplateContentPage(template)?.settings ?? template.settings ?? {};
}

export function getTemplateDocumentHtml(template: TemplateEditorValue): string {
  if (typeof template === "string") return template;
  return (
    getTemplateContentPage(template)?.settings?.documentHtml ??
    template.documentHtml ??
    template.html ??
    template.settings?.documentHtml ??
    ""
  );
}

export function renderTemplateHtml(template: TemplateEditorValue, values: Record<string, unknown>): string {
  const source = sanitizeTemplateHtml(getTemplateDocumentHtml(template));
  const document = new DOMParser().parseFromString(`<div id="form-template-root">${source}</div>`, "text/html");
  const root = document.getElementById("form-template-root");
  if (!root) return source;

  replaceTemplateTextTokens(root, values);

  root.querySelectorAll<HTMLElement>("[data-template-tag-value]").forEach((element) => {
    const key = normalizeTemplateDataTagKey(element.dataset.templateTagValue || "");
    const rawValue = resolveTemplateDataTagValue(key, values);
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
    const value = String(resolveTemplateDataTagValue(sourceKey, values));
    const objectType = image.dataset.templateObjectType || "barcode";
    const source = createTemplateGeneratedObjectDataUrl(objectType, value);

    if (source) image.src = source;
    else image.removeAttribute("src");
    image.alt = `${value || sourceKey} ${objectType === "qrcode" ? "QR코드" : "Code128 바코드"}`;
    image.removeAttribute("data-render-pending");
  });
  return sanitizeTemplateHtml(root.innerHTML);
}

function replaceTemplateTextTokens(root: HTMLElement, values: Record<string, unknown>) {
  const textNodes: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    if (!textNode.parentElement?.closest("[data-template-tag-value]")) textNodes.push(textNode);
  }
  textNodes.forEach((textNode) => {
    textNode.textContent = String(textNode.textContent || "").replace(
      /(?:{{\s*([\w.]+)\s*}}|@\{\s*([\w.]+)\s*\})/g,
      (_match, mustacheKey: string | undefined, atKey: string | undefined) =>
        String(resolveTemplateDataTagValue(mustacheKey || atKey || "", values) ?? ""),
    );
  });
}

export function openTemplatePrintWindow(title: string, bodyHtml: string) {
  const printWindow = window.open("", "_blank", "width=1000,height=800");
  if (!printWindow) throw new Error("팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.");
  const { css } = getTemplatePrintPresentation(bodyHtml);
  printWindow.opener = null;
  printWindow.document.open();
  printWindow.document.write(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>*{box-sizing:border-box}body{margin:0;color:#111827;font-family:"Noto Sans KR",Arial,sans-serif}.print-toolbar{position:sticky;top:0;display:flex;justify-content:flex-end;gap:8px;padding:10px;background:#edf2f7;border-bottom:1px solid #cbd5e1}.print-toolbar button{border:0;border-radius:8px;padding:9px 14px;color:white;background:#176b5f;font-weight:700;cursor:pointer}.template-generated-object[data-render-pending="true"]{display:inline-grid;place-items:center;min-width:120px;min-height:54px;border:1px dashed #94a3b8;font-size:11px}${css}</style></head><body><div class="print-toolbar"><button onclick="window.print()">인쇄</button></div><main class="print-document examlist-template-editor"><div class="editor-document-surface template-editor-surface">${sanitizeTemplateHtml(bodyHtml)}</div></main></body></html>`,
  );
  printWindow.document.close();
  joinFullSizePrintTables(printWindow.document.body);
}

export interface PdfGenerationOptions {
  signal?: AbortSignal;
  imageTimeoutMs?: number;
  renderTimeoutMs?: number;
  onProgress?(completed: number, total: number): void;
}

export async function downloadTemplatePdf(
  title: string,
  pagesHtml: string[] | { length: number; getPage(index: number): Promise<string> },
  template: TemplateEditorValue,
  options: PdfGenerationOptions = {},
) {
  if (!pagesHtml.length) throw new Error("PDF로 생성할 데이터가 없습니다.");
  throwIfAborted(options.signal);
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  throwIfAborted(options.signal);
  // Use the preview's document styles without changing the live operator screen.
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.title = "PDF 인쇄 준비";
  Object.assign(frame.style, { position: "fixed", left: "-20000px", top: "0", border: "0", pointerEvents: "none" });
  document.body.append(frame);
  try {
    const printDocument = frame.contentDocument;
    if (!printDocument) throw new Error("PDF 인쇄 화면을 준비하지 못했습니다.");
    printDocument.head.innerHTML = '<meta charset="utf-8">';
    const style = printDocument.createElement("style");
    printDocument.head.append(style);
    const fontCss = collectPrintFontFaces();
    const fontCache = new Map<string, Promise<string>>();
    let pdf: InstanceType<typeof jsPDF> | undefined;
    for (let index = 0; index < pagesHtml.length; index += 1) {
      throwIfAborted(options.signal);
      const html = printableDocumentHtml(
        Array.isArray(pagesHtml) ? pagesHtml[index] : await pagesHtml.getPage(index),
        template,
      );
      const presentation = getTemplatePrintPresentation(html);
      const { width, height } = presentation;
      const orientation = width > height ? "landscape" : "portrait";
      const format: [number, number] = [(width * 25.4) / 96, (height * 25.4) / 96];
      if (!pdf) pdf = new jsPDF({ orientation, unit: "mm", format, compress: true });
      else pdf.addPage(format, orientation);
      frame.style.width = `${width}px`;
      frame.style.height = `${height}px`;
      style.textContent = fontCss + "\n*{box-sizing:border-box}body{margin:0}" + presentation.css;
      const page = printDocument.createElement("section");
      page.className = "generated-pdf-page print-document examlist-template-editor";
      page.style.height = `${height}px`;
      page.style.overflow = "hidden";
      const surface = printDocument.createElement("div");
      surface.className = "editor-document-surface template-editor-surface";
      surface.innerHTML = sanitizeTemplateHtml(html);
      page.append(surface);
      const captureStyles = printDocument.createElement("style");
      captureStyles.textContent = templatePrintTokenFlowCss;
      page.prepend(captureStyles);
      printDocument.body.replaceChildren(page);
      appendPrintPageNumber(page, template, index + 1, pagesHtml.length);
      await withDeadline(
        printDocument.fonts?.ready || document.fonts.ready,
        15_000,
        "PDF 글꼴 준비 시간이 초과되었습니다.",
        options.signal,
      );
      await waitForImages(page, options.imageTimeoutMs ?? 15_000, options.signal);
      await withDeadline(
        embedLoadedPrintFonts(page, fontCache, options.signal),
        15_000,
        "PDF 글꼴 준비 시간이 초과되었습니다.",
        options.signal,
      );
      joinFullSizePrintTables(page);
      // Foreign-object capture drops every <style> while copying computed
      // styles. Restore our embedded fonts and auto-width rules AFTER cloning,
      // so the final SVG cannot fall back to a different font in frozen boxes.
      const captureCss = [...page.querySelectorAll("style")].map((element) => element.textContent || "").join("\n");
      const canvas = await withDeadline(
        html2canvas(page, {
          backgroundColor: "#ffffff",
          scale: 1.35,
          foreignObjectRendering: true,
          useCORS: true,
          logging: false,
          width,
          height,
          onclone: async (clonedDocument, clonedPage) => {
            const embeddedStyles = clonedDocument.createElement("style");
            embeddedStyles.textContent = captureCss;
            clonedPage.append(embeddedStyles);
            await clonedDocument.fonts?.ready;
          },
        }),
        options.renderTimeoutMs ?? 30_000,
        `PDF ${index + 1}페이지 렌더링 시간이 초과되었습니다.`,
        options.signal,
      );
      throwIfAborted(options.signal);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pdfWidth, pdfHeight, undefined, "FAST");
      canvas.width = 0;
      canvas.height = 0;
      options.onProgress?.(index + 1, pagesHtml.length);
      printDocument.body.replaceChildren();
    }
    throwIfAborted(options.signal);
    pdf?.save(`${safeFileName(title)}.pdf`);
  } finally {
    frame.remove();
  }
}

function printableDocumentHtml(html: string, template: TemplateEditorValue) {
  const root = new DOMParser().parseFromString(sanitizeTemplateHtml(html), "text/html").body;
  let doc = root.querySelector<HTMLElement>(".template-doc");
  if (!doc) {
    doc = root.ownerDocument.createElement("div");
    doc.className = "template-doc";
    doc.append(...root.childNodes);
    root.append(doc);
  }
  if (!doc.dataset.templatePageOrientation && typeof template !== "string") {
    doc.dataset.templatePageOrientation = String(
      getTemplatePageSettings(template).orientation || template.orientation || "portrait",
    );
  }
  return root.innerHTML;
}

function collectPrintFontFaces() {
  return [...document.styleSheets]
    .flatMap((sheet) => {
      try {
        return [...sheet.cssRules].filter((rule) => rule.type === CSSRule.FONT_FACE_RULE).map((rule) => rule.cssText);
      } catch {
        return [];
      }
    })
    .join("\n");
}

function appendPrintPageNumber(page: HTMLElement, template: TemplateEditorValue, current: number, total: number) {
  const config = getTemplatePageSettings(template).pageNumber as
    { enabled?: boolean; position?: string; preset?: string } | undefined;
  if (!config?.enabled) return;
  const texts: Record<string, string> = {
    numericCurrentTotal: `${current}/${total}`,
    pageCurrentTotal: `페이지 ${current}/${total}`,
    pageCurrentTotalEnglish: `Page ${current}/${total}`,
    currentPageKorean: `${current}페이지`,
    koreanPage: `${current}쪽`,
    currentPageOfTotalKorean: `${current}페이지 중 ${total}페이지`,
    koreanPageOfTotal: `${current}쪽 중 ${total}쪽`,
  };
  const footer = page.ownerDocument.createElement("div");
  footer.className = "generated-pdf-page-number";
  footer.textContent = texts[config.preset || "numericCurrentTotal"] || texts.numericCurrentTotal;
  const computed = page.ownerDocument.defaultView!.getComputedStyle(page);
  Object.assign(footer.style, {
    position: "absolute",
    bottom: "19px",
    left: computed.paddingLeft,
    right: computed.paddingRight,
    textAlign: ["left", "right"].includes(config.position || "") ? config.position : "center",
    fontSize: "12px",
    lineHeight: "1",
    fontWeight: "800",
  });
  page.append(footer);
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
