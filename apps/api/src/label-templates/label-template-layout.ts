import { BadRequestException } from "@nestjs/common";
import { formTemplateDataTags } from "../form-templates/form-template-tags.js";

export const LABEL_TEMPLATE_CODE = "PSEUDONYM_LABEL";
export const LABEL_DATA_TAG_CATALOG = formTemplateDataTags;
export const LABEL_DATA_TAGS = formTemplateDataTags.groups.flatMap((group) => group.tags);

const LEGACY_LABEL_TAGS = {
  PSEUDONYM_NO: "candidate.temporaryNo",
  EXAMINEE_NO: "candidate.examNo",
  ROOM_NAME: "candidate.roomName",
  SEAT_NO: "candidate.seatNo",
  BARCODE: "candidate.labelBarcode",
  EXAM_DATE: "candidate.examDate",
} as const;

export type LabelElementKind = "text" | "barcode" | "line" | "box";

export interface LabelTemplateElement {
  id: string;
  kind: LabelElementKind;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  rotation?: 0 | 90 | 180 | 270;
  content?: string;
  fontSizeMm?: number;
  align?: "left" | "center" | "right";
  showText?: boolean;
  strokeWidthMm?: number;
}

export interface LabelTemplateLayout {
  widthMm: number;
  heightMm: number;
  dpi: 203 | 300;
  elements: LabelTemplateElement[];
  sampleData?: Record<string, string>;
}

export const defaultLabelTemplateLayout: LabelTemplateLayout = {
  widthMm: 75,
  heightMm: 45,
  dpi: 203,
  elements: [
    {
      id: "pseudonym",
      kind: "text",
      xMm: 4,
      yMm: 4,
      widthMm: 67,
      heightMm: 12,
      content: "{{candidate.temporaryNo}}",
      fontSizeMm: 9,
      align: "center",
    },
    {
      id: "barcode",
      kind: "barcode",
      xMm: 8,
      yMm: 19,
      widthMm: 59,
      heightMm: 13,
      content: "{{candidate.temporaryNo}}",
      showText: true,
    },
    {
      id: "examinee",
      kind: "text",
      xMm: 4,
      yMm: 37,
      widthMm: 67,
      heightMm: 4,
      content: "EXAM: {{candidate.examNo}}",
      fontSizeMm: 2.8,
      align: "center",
    },
  ],
};

export function parseLabelTemplateLayout(value: unknown): LabelTemplateLayout {
  const layout = typeof value === "string" ? parseJson(value) : value;
  if (!isRecord(layout)) throw invalidLayout();
  const widthMm = finiteNumber(layout.widthMm, "라벨 너비");
  const heightMm = finiteNumber(layout.heightMm, "라벨 높이");
  const dpi = Number(layout.dpi);
  if (widthMm < 20 || widthMm > 200 || heightMm < 10 || heightMm > 150) {
    throw new BadRequestException("라벨 크기는 너비 20~200mm, 높이 10~150mm 범위로 설정해 주세요.");
  }
  if (dpi !== 203 && dpi !== 300) throw new BadRequestException("프린터 해상도는 203dpi 또는 300dpi만 지원합니다.");
  if (!Array.isArray(layout.elements) || layout.elements.length > 50) {
    throw new BadRequestException("라벨 요소는 최대 50개까지 배치할 수 있습니다.");
  }
  const ids = new Set<string>();
  const elements = layout.elements.map((item, index) => parseElement(item, index, widthMm, heightMm, ids));
  const sampleData = parseSampleData(layout.sampleData);
  return { widthMm, heightMm, dpi, elements, ...(sampleData ? { sampleData } : {}) };
}

export function buildLabelZpl(layoutValue: unknown): { layout: LabelTemplateLayout; zplTemplate: string } {
  const layout = parseLabelTemplateLayout(layoutValue);
  const dotsPerMm = layout.dpi / 25.4;
  const dot = (millimeters: number, minimum = 0) => Math.max(minimum, Math.round(millimeters * dotsPerMm));
  const commands = layout.elements.map((element) =>
    buildLabelElementZpl(element, layout.dpi, toPrinterTemplateContent(element.content ?? "")),
  );
  return {
    layout,
    zplTemplate: `^XA^PW${dot(layout.widthMm, 1)}^LL${dot(layout.heightMm, 1)}^LH0,0${commands.join("")}^XZ`,
  };
}

export function buildLabelElementZpl(element: LabelTemplateElement, dpi: number, content: string): string {
  const dot = (mm: number, minimum = 0) => Math.max(minimum, Math.round((mm * dpi) / 25.4));
  let x = dot(element.xMm);
  let y = dot(element.yMm);
  const width = dot(element.widthMm, 1);
  const height = dot(element.heightMm, 1);
  const rotation = element.rotation ?? 0;
  const orientation = { 0: "N", 90: "R", 180: "I", 270: "B" }[rotation];
  // ^FO specifies the upper-left of the field area independently of rotation.
  if (element.kind === "text") {
    const font = dot(element.fontSizeMm ?? 3, 8);
    const alignment = element.align === "center" ? "C" : element.align === "right" ? "R" : "L";
    return `^FO${x},${y}^A0${orientation},${font},${font}^FB${width},1,0,${alignment},0^FD${content}^FS`;
  }
  if (element.kind === "barcode") {
    const moduleWidth = Math.max(1, Math.min(10, Math.round(width / 120)));
    return `^FO${x},${y}^BY${moduleWidth},2,${height}^BC${orientation},${height},${element.showText === false ? "N" : "Y"},N,N^FD${content}^FS`;
  }
  const thickness = dot(element.strokeWidthMm ?? 0.4, 1);
  const sideways = rotation === 90 || rotation === 270;
  let boxWidth = sideways ? height : width;
  let boxHeight = sideways ? width : height;
  if (element.kind === "line") {
    if (sideways) boxWidth = thickness;
    else boxHeight = thickness;
    if (rotation === 90) x += Math.max(0, height - thickness);
    if (rotation === 180) y += Math.max(0, height - thickness);
  }
  return `^FO${x},${y}^GB${boxWidth},${boxHeight},${thickness},B,0^FS`;
}

export function labelTemplateSampleValues(overrides: Record<string, string> = {}): Record<string, string> {
  return toLabelTemplateZplValues(
    Object.fromEntries(LABEL_DATA_TAGS.map((tag) => [tag.key, overrides[tag.key] ?? String(tag.example ?? "")])),
  );
}

export function toLabelTemplateZplValues(values: Readonly<Record<string, string | number>>): Record<string, string> {
  const result = Object.fromEntries(
    LABEL_DATA_TAGS.map((tag) => [labelTemplateZplKey(tag.key), String(values[tag.key] ?? "")]),
  );
  for (const [legacyKey, canonicalKey] of Object.entries(LEGACY_LABEL_TAGS)) {
    result[legacyKey] = String(values[canonicalKey] ?? "");
  }
  return result;
}

export function labelTemplateZplKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toUpperCase();
}

function parseElement(
  value: unknown,
  index: number,
  labelWidth: number,
  labelHeight: number,
  ids: Set<string>,
): LabelTemplateElement {
  if (!isRecord(value)) throw new BadRequestException(`${index + 1}번째 라벨 요소가 올바르지 않습니다.`);
  const id = String(value.id ?? "").trim();
  const kind = String(value.kind ?? "") as LabelElementKind;
  if (!/^[A-Za-z0-9_-]{1,50}$/.test(id) || ids.has(id)) {
    throw new BadRequestException("라벨 요소 식별자는 서로 다른 영문·숫자 값이어야 합니다.");
  }
  ids.add(id);
  if (!["text", "barcode", "line", "box"].includes(kind)) {
    throw new BadRequestException("지원하지 않는 라벨 요소 형식입니다.");
  }
  const xMm = finiteNumber(value.xMm, "가로 위치");
  const yMm = finiteNumber(value.yMm, "세로 위치");
  const widthMm = finiteNumber(value.widthMm, "요소 너비");
  const heightMm = finiteNumber(value.heightMm, "요소 높이");
  const rotation = value.rotation === undefined ? 0 : value.rotation;
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
    throw new BadRequestException("회전 각도는 0°, 90°, 180°, 270° 중에서 선택해 주세요.");
  }
  const sideways = rotation === 90 || rotation === 270;
  if (
    xMm < 0 ||
    yMm < 0 ||
    widthMm <= 0 ||
    heightMm <= 0 ||
    xMm + (sideways ? heightMm : widthMm) > labelWidth ||
    yMm + (sideways ? widthMm : heightMm) > labelHeight
  ) {
    throw new BadRequestException("라벨 요소가 출력 영역을 벗어났습니다.");
  }
  const element: LabelTemplateElement = { id, kind, xMm, yMm, widthMm, heightMm };
  if (value.rotation !== undefined) element.rotation = rotation;
  if (kind === "text" || kind === "barcode") {
    const content = String(value.content ?? "").trim();
    if (!content || content.length > 200)
      throw new BadRequestException("텍스트와 바코드 내용은 1~200자로 입력해 주세요.");
    assertSupportedPlaceholders(content);
    element.content = content;
  }
  if (kind === "text") {
    // Preserve point-to-mm conversions when the editor saves a font size in pt.
    const fontSizeMm = finiteNumber(value.fontSizeMm ?? 3, "글자 크기", 6);
    if (fontSizeMm < 1.5 || fontSizeMm > 20)
      throw new BadRequestException("글자 크기는 1.5~20mm 범위로 설정해 주세요.");
    const align = value.align ?? "left";
    if (align !== "left" && align !== "center" && align !== "right") throw invalidLayout();
    element.fontSizeMm = fontSizeMm;
    element.align = align;
  }
  if (kind === "barcode") element.showText = value.showText !== false;
  if (kind === "line" || kind === "box") {
    const strokeWidthMm = finiteNumber(value.strokeWidthMm ?? 0.4, "선 굵기");
    if (strokeWidthMm < 0.1 || strokeWidthMm > 5)
      throw new BadRequestException("선 굵기는 0.1~5mm 범위로 설정해 주세요.");
    element.strokeWidthMm = strokeWidthMm;
  }
  return element;
}

function assertSupportedPlaceholders(content: string) {
  const allowed = new Set<string>(LABEL_DATA_TAGS.map((tag) => tag.key));
  Object.keys(LEGACY_LABEL_TAGS).forEach((key) => allowed.add(key));
  for (const match of content.matchAll(/\{\{([^{}]+)\}\}/g)) {
    if (!allowed.has(match[1] ?? ""))
      throw new BadRequestException(`지원하지 않는 라벨 데이터 태그입니다: ${match[0]}`);
  }
  if (content.replace(/\{\{[^{}]+\}\}/g, "").includes("{{")) {
    throw new BadRequestException("라벨 데이터 태그 형식을 확인해 주세요.");
  }
}

function toPrinterTemplateContent(value: string): string {
  return safeContent(value).replace(/\{\{([^{}]+)\}\}/g, (_, key: string) => `{{${labelTemplateZplKey(key)}}}`);
}

function safeContent(value: string): string {
  return value.replace(/[\^~\r\n]/g, " ").trim();
}

function parseSampleData(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw invalidLayout();
  const allowed = new Set(LABEL_DATA_TAGS.map((tag) => tag.key));
  const entries = Object.entries(value);
  if (
    entries.length > allowed.size ||
    entries.some(([key, sample]) => !allowed.has(key) || typeof sample !== "string")
  ) {
    throw invalidLayout();
  }
  return Object.fromEntries(entries.map(([key, sample]) => [key, String(sample).slice(0, 500)]));
}

function finiteNumber(value: unknown, label: string, decimalPlaces = 1): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new BadRequestException(`${label} 값을 확인해 주세요.`);
  const scale = 10 ** decimalPlaces;
  return Math.round(number * scale) / scale;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw invalidLayout();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidLayout() {
  return new BadRequestException("라벨 양식 정보를 확인해 주세요.");
}
