import { createWorkLimiter } from "../common/bounded-work.js";
import sharp from "sharp";
import {
  buildLabelElementZpl,
  labelTemplateZplKey,
  parseLabelTemplateLayout,
  type LabelTemplateElement,
  type LabelTemplateLayout,
} from "./label-template-layout.js";

const renderLimited = createWorkLimiter(2);
type Graphic = { bytesPerRow: number; totalBytes: number; hex: string };
const graphicCache = new Map<string, Graphic>();
let cacheBytes = 0;
const NON_ASCII_TEXT = /[^\x20-\x7e]/;
const FONT_FAMILY = "'Malgun Gothic', 'Noto Sans CJK KR', 'Arial Unicode MS', sans-serif";

export async function renderLabelPayload(
  layoutValue: unknown,
  values: Readonly<Record<string, string | number>>,
): Promise<string> {
  const layout = parseLabelTemplateLayout(layoutValue);
  const dotsPerMm = layout.dpi / 25.4;
  const dot = (millimeters: number, minimum = 0) => Math.max(minimum, Math.round(millimeters * dotsPerMm));
  const commands = await renderElements(layout, values);
  return `^XA^CI28^PW${dot(layout.widthMm, 1)}^LL${dot(layout.heightMm, 1)}^LH0,0${commands.join("")}^XZ`;
}

async function renderElement(
  element: LabelTemplateElement,
  layout: LabelTemplateLayout,
  values: Readonly<Record<string, string | number>>,
): Promise<string> {
  const dotsPerMm = layout.dpi / 25.4;
  const dot = (millimeters: number, minimum = 0) => Math.max(minimum, Math.round(millimeters * dotsPerMm));
  const x = dot(element.xMm);
  const y = dot(element.yMm);
  const width = dot(element.widthMm, 1);
  const height = dot(element.heightMm, 1);

  if (element.kind === "text") {
    const content = renderContent(element.content ?? "텍스트", values);
    const font = dot(element.fontSizeMm ?? 3, 8);
    if (NON_ASCII_TEXT.test(content)) {
      const graphic = await cachedRaster(
        content,
        width,
        height,
        font,
        element.align ?? "left",
        element.rotation ?? 0,
        !element.content?.includes("{{"),
      );
      return `^FO${x},${y}^GFA,${graphic.totalBytes},${graphic.totalBytes},${graphic.bytesPerRow},${graphic.hex}^FS`;
    }
    return buildLabelElementZpl(element, layout.dpi, content);
  }
  if (element.kind === "barcode") {
    const content = renderContent(element.content ?? "{{candidate.temporaryNo}}", values);
    return buildLabelElementZpl(element, layout.dpi, content);
  }
  return buildLabelElementZpl(element, layout.dpi, "");
}

function renderContent(content: string, values: Readonly<Record<string, string | number>>): string {
  const rendered = content.replace(/\{\{([^{}]+)\}\}/g, (_, key: string) => {
    const valueKey = labelTemplateZplKey(key);
    if (!(valueKey in values)) throw new Error(`Missing template value: ${valueKey}`);
    return String(values[valueKey]);
  });
  return rendered.replace(/[\^~\r\n]/g, " ").trim();
}

async function rasterizeText(
  content: string,
  width: number,
  height: number,
  fontSize: number,
  align: "left" | "center" | "right",
  rotation: NonNullable<LabelTemplateElement["rotation"]>,
) {
  const x = align === "center" ? width / 2 : align === "right" ? width : 0;
  const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="white"/>
    <text x="${x}" y="${height / 2}" dominant-baseline="middle" text-anchor="${anchor}"
      font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="600" fill="black">${escapeXml(content)}</text>
  </svg>`;
  const { data, info } = await sharp(Buffer.from(svg))
    .rotate(rotation)
    .flatten({ background: "#ffffff" })
    .grayscale()
    .threshold(190)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bytesPerRow = Math.ceil(info.width / 8);
  const bytes = Buffer.alloc(bytesPerRow * info.height);
  for (let row = 0; row < info.height; row += 1) {
    for (let column = 0; column < info.width; column += 1) {
      if ((data[row * info.width + column] ?? 255) < 128) {
        bytes[row * bytesPerRow + Math.floor(column / 8)]! |= 0x80 >> (column % 8);
      }
    }
  }
  return { bytesPerRow, totalBytes: bytes.length, hex: bytes.toString("hex").toUpperCase() };
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&apos;";
  });
}

async function renderElements(layout: LabelTemplateLayout, values: Readonly<Record<string, string | number>>) {
  const commands: string[] = [];
  // Each request holds at most two element conversions, with a global Sharp limit.
  for (let offset = 0; offset < layout.elements.length; offset += 2) {
    commands.push(
      ...(await Promise.all(
        layout.elements.slice(offset, offset + 2).map((element) => renderElement(element, layout, values)),
      )),
    );
  }
  return commands;
}
async function cachedRaster(
  content: string,
  width: number,
  height: number,
  font: number,
  align: "left" | "center" | "right",
  rotation: NonNullable<LabelTemplateElement["rotation"]>,
  cacheable: boolean,
) {
  const key = JSON.stringify([FONT_FAMILY, content, width, height, font, align, rotation]);
  const cached = cacheable ? graphicCache.get(key) : undefined;
  if (cached) {
    graphicCache.delete(key);
    graphicCache.set(key, cached);
    return cached;
  }
  return renderLimited(async () => {
    const concurrent = cacheable ? graphicCache.get(key) : undefined;
    if (concurrent) return concurrent;
    const graphic = await rasterizeText(content, width, height, font, align, rotation);
    const size = graphic.hex.length * 2 + key.length * 2;
    if (cacheable && size <= 4 * 1024 * 1024) {
      while (graphicCache.size && (graphicCache.size >= 512 || cacheBytes + size > 4 * 1024 * 1024)) {
        const [oldKey, oldValue] = graphicCache.entries().next().value!;
        cacheBytes -= oldValue.hex.length * 2 + oldKey.length * 2;
        graphicCache.delete(oldKey);
      }
      graphicCache.set(key, graphic);
      cacheBytes += size;
    }
    return graphic;
  });
}
