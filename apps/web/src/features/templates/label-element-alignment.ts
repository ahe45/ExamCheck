import type { LabelTemplateElement, LabelTemplateLayout } from "../../shared/api/label-templates";

export type LabelAlignment =
  "left" | "center-x" | "right" | "top" | "center-y" | "bottom" | "distribute-x" | "distribute-y";
export type LabelAlignmentTarget = "paper" | "selection";

export function labelElementBounds(element: LabelTemplateElement) {
  const sideways = element.rotation === 90 || element.rotation === 270;
  return {
    x: element.xMm,
    y: element.yMm,
    width: sideways ? element.heightMm : element.widthMm,
    height: sideways ? element.widthMm : element.heightMm,
  };
}

function selectionBounds(elements: LabelTemplateElement[]) {
  const bounds = elements.map(labelElementBounds);
  const x = Math.min(...bounds.map((item) => item.x));
  const y = Math.min(...bounds.map((item) => item.y));
  return {
    x,
    y,
    width: Math.max(...bounds.map((item) => item.x + item.width)) - x,
    height: Math.max(...bounds.map((item) => item.y + item.height)) - y,
  };
}

const round = (value: number) => Math.round(value * 10) / 10;

export function alignLabelElements(
  layout: LabelTemplateLayout,
  ids: readonly string[],
  command: LabelAlignment,
  target: LabelAlignmentTarget,
): LabelTemplateLayout {
  const elements = layout.elements.filter((element) => ids.includes(element.id));
  const distribution = command === "distribute-x" || command === "distribute-y";
  if (elements.length < (distribution ? 3 : target === "selection" ? 2 : 1)) return layout;
  // Paper alignment treats the selected objects as one bounding box.
  // Translate the entire group so its internal spacing and rotations stay intact.
  if (!distribution && target === "paper") {
    const bounds = selectionBounds(elements);
    let dx = 0;
    let dy = 0;
    if (command === "left") dx = -bounds.x;
    if (command === "center-x") dx = (layout.widthMm - bounds.width) / 2 - bounds.x;
    if (command === "right") dx = layout.widthMm - bounds.width - bounds.x;
    if (command === "top") dy = -bounds.y;
    if (command === "center-y") dy = (layout.heightMm - bounds.height) / 2 - bounds.y;
    if (command === "bottom") dy = layout.heightMm - bounds.height - bounds.y;
    return moveLabelElements(layout, ids, round(dx), round(dy));
  }
  // Spacing always uses the outer selected objects, as in the document editor.
  const bounds =
    target === "selection" || distribution
      ? selectionBounds(elements)
      : { x: 0, y: 0, width: layout.widthMm, height: layout.heightMm };
  const positions = new Map<string, { xMm: number; yMm: number }>();
  if (distribution) {
    const horizontal = command === "distribute-x";
    const axis = horizontal ? "x" : "y";
    const size = horizontal ? "width" : "height";
    const sorted = [...elements].sort((a, b) => labelElementBounds(a)[axis] - labelElementBounds(b)[axis]);
    const total = sorted.reduce((sum, element) => sum + labelElementBounds(element)[size], 0);
    const gap = (bounds[size] - total) / (sorted.length - 1);
    // Do not silently push objects outside the paper when they cannot fit without overlap.
    if (gap < -0.000001) return layout;
    let cursor = bounds[axis];
    for (const element of sorted) {
      positions.set(element.id, {
        xMm: horizontal ? round(cursor) : element.xMm,
        yMm: horizontal ? element.yMm : round(cursor),
      });
      cursor += labelElementBounds(element)[size] + gap;
    }
  } else {
    for (const element of elements) {
      const size = labelElementBounds(element);
      let xMm = element.xMm;
      let yMm = element.yMm;
      if (command === "left") xMm = bounds.x;
      if (command === "center-x") xMm = bounds.x + (bounds.width - size.width) / 2;
      if (command === "right") xMm = bounds.x + bounds.width - size.width;
      if (command === "top") yMm = bounds.y;
      if (command === "center-y") yMm = bounds.y + (bounds.height - size.height) / 2;
      if (command === "bottom") yMm = bounds.y + bounds.height - size.height;
      positions.set(element.id, { xMm: round(xMm), yMm: round(yMm) });
    }
  }
  return {
    ...layout,
    elements: layout.elements.map((element) =>
      positions.has(element.id) ? { ...element, ...positions.get(element.id) } : element,
    ),
  };
}

export function moveLabelElements(
  layout: LabelTemplateLayout,
  ids: readonly string[],
  dx: number,
  dy: number,
): LabelTemplateLayout {
  const elements = layout.elements.filter((element) => ids.includes(element.id));
  if (!elements.length) return layout;
  const bounds = selectionBounds(elements);
  const moveX = Math.min(Math.max(dx, -bounds.x), layout.widthMm - bounds.x - bounds.width);
  const moveY = Math.min(Math.max(dy, -bounds.y), layout.heightMm - bounds.y - bounds.height);
  if (Math.abs(moveX) < 0.000001 && Math.abs(moveY) < 0.000001) return layout;
  return {
    ...layout,
    elements: layout.elements.map((element) =>
      ids.includes(element.id)
        ? {
            ...element,
            xMm: round(element.xMm + moveX),
            yMm: round(element.yMm + moveY),
          }
        : element,
    ),
  };
}
