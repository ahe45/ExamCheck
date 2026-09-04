import sharp from "sharp";
import {
  labelTemplateZplKey,
  parseLabelTemplateLayout,
  type LabelTemplateElement,
  type LabelTemplateLayout,
} from "./label-template-layout.js";

const NON_ASCII_TEXT = /[^\x20-\x7e]/;
const FONT_FAMILY = "'Malgun Gothic', 'Noto Sans CJK KR', 'Arial Unicode MS', sans-serif";

export async function renderLabelPayload(
  layoutValue: unknown,
  values: Readonly<Record<string, string | number>>,
): Promise<string> {
  const layout = parseLabelTemplateLayout(layoutValue);
  const dotsPerMm = layout.dpi / 25.4;
  const dot = (millimeters: number, minimum = 0) => Math.max(minimum, Math.round(millimeters * dotsPerMm));
  const commands = await Promise.all(layout.elements.map((element) => renderElement(element, layout, values)));
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
      const graphic = await rasterizeText(content, width, height, font, element.align ?? "left");
      return `^FO${x},${y}^GFA,${graphic.totalBytes},${graphic.totalBytes},${graphic.bytesPerRow},${graphic.hex}^FS`;
    }
    const alignment = element.align === "center" ? "C" : element.align === "right" ? "R" : "L";
    return `^FO${x},${y}^A0N,${font},${font}^FB${width},1,0,${alignment},0^FD${content}^FS`;
  }
  if (element.kind === "barcode") {
    const moduleWidth = Math.max(1, Math.min(10, Math.round(width / 120)));
    const content = renderContent(element.content ?? "{{candidate.temporaryNo}}", values);
    return `^FO${x},${y}^BY${moduleWidth},2,${height}^BCN,${height},${element.showText === false ? "N" : "Y"},N,N^FD${content}^FS`;
  }
  const thickness = dot(element.strokeWidthMm ?? 0.4, 1);
  const boxHeight = element.kind === "line" ? thickness : height;
  return `^FO${x},${y}^GB${width},${boxHeight},${thickness},B,0^FS`;
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
) {
  const x = align === "center" ? width / 2 : align === "right" ? width : 0;
  const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="white"/>
    <text x="${x}" y="${height / 2}" dominant-baseline="middle" text-anchor="${anchor}"
      font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="600" fill="black">${escapeXml(content)}</text>
  </svg>`;
  const { data, info } = await sharp(Buffer.from(svg))
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
