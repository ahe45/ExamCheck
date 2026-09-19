import type { LabelElementKind, LabelTemplateElement, LabelTemplateLayout } from "../../shared/api/label-templates";
import type { DataTagCatalog, DataTagDefinition } from "../../shared/templates/template-editor-contracts";

export const defaultLabelLayout: LabelTemplateLayout = {
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

export function cloneLabelLayout(layout: LabelTemplateLayout): LabelTemplateLayout {
  return {
    ...layout,
    elements: layout.elements.map((element) => ({
      ...element,
      ...(element.content ? { content: normalizeLegacyLabelTags(element.content) } : {}),
    })),
    ...(layout.sampleData ? { sampleData: { ...layout.sampleData } } : {}),
  };
}

export function createLabelElement(kind: LabelElementKind, sequence: number): LabelTemplateElement {
  const common = { id: `${kind}-${sequence}`, kind, xMm: 5, yMm: 5, widthMm: 30, heightMm: 7 };
  if (kind === "text") return { ...common, content: "텍스트", fontSizeMm: 3, align: "left" };
  if (kind === "barcode") return { ...common, heightMm: 14, content: "{{candidate.temporaryNo}}", showText: true };
  return { ...common, heightMm: kind === "line" ? 1 : 12, strokeWidthMm: 0.4 };
}

export function flattenLabelDataTags(catalog: DataTagCatalog): DataTagDefinition[] {
  return [
    ...(Array.isArray(catalog.tags) ? catalog.tags : []),
    ...(Array.isArray(catalog.groups)
      ? catalog.groups.flatMap((group) => (Array.isArray(group.tags) ? group.tags : []))
      : []),
  ];
}

export function replaceLabelSamples(content: string, tags: DataTagDefinition[], showSamples = true): string {
  return tags.reduce((value, tag) => {
    const key = String(tag.key || tag.dataKey || "");
    const display = showSamples ? String(tag.example ?? "") : `#${String(tag.label || key)}`;
    return key ? value.replaceAll(`{{${key}}}`, display) : value;
  }, content);
}

export function clampLabelElement(element: LabelTemplateElement, layout: LabelTemplateLayout): LabelTemplateElement {
  const sideways = element.rotation === 90 || element.rotation === 270;
  const widthMm = round(Math.min(Math.max(0.5, element.widthMm), sideways ? layout.heightMm : layout.widthMm));
  const heightMm = round(Math.min(Math.max(0.5, element.heightMm), sideways ? layout.widthMm : layout.heightMm));
  return {
    ...element,
    widthMm: round(widthMm),
    heightMm: round(heightMm),
    xMm: round(Math.min(Math.max(0, element.xMm), layout.widthMm - (sideways ? heightMm : widthMm))),
    yMm: round(Math.min(Math.max(0, element.yMm), layout.heightMm - (sideways ? widthMm : heightMm))),
  };
}

export function rotateLabelElement(
  element: LabelTemplateElement,
  delta: -90 | 90,
  layout: LabelTemplateLayout,
): LabelTemplateElement {
  const sideways = element.rotation === 90 || element.rotation === 270;
  const centerX = element.xMm + (sideways ? element.heightMm : element.widthMm) / 2;
  const centerY = element.yMm + (sideways ? element.widthMm : element.heightMm) / 2;
  const rotated = clampLabelElement(
    {
      ...element,
      rotation: (((element.rotation ?? 0) + delta + 360) % 360) as LabelTemplateElement["rotation"],
    },
    layout,
  );
  const nextSideways = rotated.rotation === 90 || rotated.rotation === 270;
  return clampLabelElement(
    {
      ...rotated,
      xMm: centerX - (nextSideways ? rotated.heightMm : rotated.widthMm) / 2,
      yMm: centerY - (nextSideways ? rotated.widthMm : rotated.heightMm) / 2,
    },
    layout,
  );
}

// Stored X/Y describe the rotated bounding box; rotation commands keep its center fixed.
export function labelElementTransform(rotation: LabelTemplateElement["rotation"]) {
  if (rotation === 90) return "rotate(90deg) translateY(-100%)";
  if (rotation === 180) return "rotate(180deg) translate(-100%, -100%)";
  if (rotation === 270) return "rotate(270deg) translateX(-100%)";
  return undefined;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function normalizeLegacyLabelTags(content: string) {
  const aliases: Record<string, string> = {
    PSEUDONYM_NO: "candidate.temporaryNo",
    EXAMINEE_NO: "candidate.examNo",
    ROOM_NAME: "candidate.roomName",
    SEAT_NO: "candidate.seatNo",
    EXAM_DATE: "candidate.examDate",
  };
  return content.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (token, key: string) =>
    aliases[key] ? `{{${aliases[key]}}}` : token,
  );
}
