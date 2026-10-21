import type { LabelTemplateElement, LabelTemplateLayout } from "../../shared/api/label-templates";
import { labelElementBounds } from "./label-element-alignment";
import { clampLabelElement } from "./label-template-model";

export const labelResizeHandles = [
  { key: "nw", label: "왼쪽 위", x: -1, y: -1 },
  { key: "n", label: "위쪽 중앙", x: 0, y: -1 },
  { key: "ne", label: "오른쪽 위", x: 1, y: -1 },
  { key: "e", label: "오른쪽 중앙", x: 1, y: 0 },
  { key: "se", label: "오른쪽 아래", x: 1, y: 1 },
  { key: "s", label: "아래쪽 중앙", x: 0, y: 1 },
  { key: "sw", label: "왼쪽 아래", x: -1, y: 1 },
  { key: "w", label: "왼쪽 중앙", x: -1, y: 0 },
] as const;
export type LabelResizeHandle = (typeof labelResizeHandles)[number]["key"];

export function resizeLabelElement(
  element: LabelTemplateElement,
  handle: LabelResizeHandle,
  dx: number,
  dy: number,
  layout: LabelTemplateLayout,
  preserveRatio: boolean,
): LabelTemplateElement {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return element;
  const { x: hx, y: hy } = labelResizeHandles.find((item) => item.key === handle)!;
  const bounds = labelElementBounds(element);
  const sideways = element.rotation === 90 || element.rotation === 270;
  const anchorX = bounds.x + (hx < 0 ? bounds.width : hx === 0 ? bounds.width / 2 : 0);
  const anchorY = bounds.y + (hy < 0 ? bounds.height : hy === 0 ? bounds.height / 2 : 0);
  const minWidth = element.kind === "text" && sideways ? 1.5 : 0.5;
  const minHeight = element.kind === "text" && !sideways ? 1.5 : 0.5;
  const maxWidth =
    hx < 0 ? anchorX : hx > 0 ? layout.widthMm - anchorX : 2 * Math.min(anchorX, layout.widthMm - anchorX);
  const maxHeight =
    hy < 0 ? anchorY : hy > 0 ? layout.heightMm - anchorY : 2 * Math.min(anchorY, layout.heightMm - anchorY);
  let width = bounds.width;
  let height = bounds.height;
  if (preserveRatio) {
    const scaleX = hx ? 1 + (hx * dx) / bounds.width : 1;
    const scaleY = hy ? 1 + (hy * dy) / bounds.height : 1;
    const requested = !hx ? scaleY : !hy ? scaleX : Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
    const scale = Math.min(
      Math.max(requested, minWidth / bounds.width, minHeight / bounds.height),
      maxWidth / bounds.width,
      maxHeight / bounds.height,
    );
    width *= scale;
    height *= scale;
  } else {
    if (hx) width = Math.min(Math.max(bounds.width + hx * dx, minWidth), maxWidth);
    if (hy) height = Math.min(Math.max(bounds.height + hy * dy, minHeight), maxHeight);
  }
  const widthMm = sideways ? height : width;
  const heightMm = sideways ? width : height;
  return clampLabelElement(
    {
      ...element,
      widthMm,
      heightMm,
      xMm: hx < 0 ? anchorX - width : hx > 0 ? anchorX : anchorX - width / 2,
      yMm: hy < 0 ? anchorY - height : hy > 0 ? anchorY : anchorY - height / 2,
      ...(element.kind === "text" ? { fontSizeMm: heightMm } : {}),
    },
    layout,
  );
}
