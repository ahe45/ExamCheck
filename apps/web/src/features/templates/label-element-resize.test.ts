import { describe, expect, it } from "vitest";
import type { LabelTemplateElement, LabelTemplateLayout } from "../../shared/api/label-templates";
import { labelElementBounds } from "./label-element-alignment";
import { labelResizeHandles, resizeLabelElement } from "./label-element-resize";

const paper: LabelTemplateLayout = { widthMm: 100, heightMm: 80, dpi: 203, elements: [] };
const element: LabelTemplateElement = {
  id: "tag",
  kind: "text",
  content: "{{candidate.name}}",
  xMm: 20,
  yMm: 20,
  widthMm: 20,
  heightMm: 10,
  fontSizeMm: 10,
};

describe("label element resize", () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    it.each(labelResizeHandles)(`${rotation}° $key keeps the opposite edge anchored`, (handle) => {
      const original = { ...element, rotation };
      const before = labelElementBounds(original);
      const resized = resizeLabelElement(original, handle.key, 5, 3, paper, false);
      const after = labelElementBounds(resized);
      expect(after.width).toBeCloseTo(before.width + handle.x * 5);
      expect(after.height).toBeCloseTo(before.height + handle.y * 3);
      expect(after.x + (handle.x < 0 ? after.width : handle.x === 0 ? after.width / 2 : 0)).toBeCloseTo(
        before.x + (handle.x < 0 ? before.width : handle.x === 0 ? before.width / 2 : 0),
      );
      expect(after.y + (handle.y < 0 ? after.height : handle.y === 0 ? after.height / 2 : 0)).toBeCloseTo(
        before.y + (handle.y < 0 ? before.height : handle.y === 0 ? before.height / 2 : 0),
      );
      expect(resized.fontSizeMm).toBe(resized.heightMm);
      expect(resized.rotation).toBe(rotation);
      expect(original).toEqual({ ...element, rotation });
    });
    it.each(labelResizeHandles)(`${rotation}° $key preserves aspect ratio with Shift`, (handle) => {
      const original = { ...element, rotation };
      const resized = resizeLabelElement(original, handle.key, handle.x * 10, handle.y * 5, paper, true);
      expect(resized.widthMm / resized.heightMm).toBeCloseTo(element.widthMm / element.heightMm, 2);
    });
  }
  it.each(labelResizeHandles)(
    "$key stays on paper and has a valid minimum size when dragged past the opposite edge",
    (handle) => {
      for (const rotation of [0, 90, 180, 270] as const)
        for (const preserve of [false, true])
          for (const delta of [-1000, 1000]) {
            const resized = resizeLabelElement(
              { ...element, rotation },
              handle.key,
              handle.x * delta,
              handle.y * delta,
              paper,
              preserve,
            );
            const bounds = labelElementBounds(resized);
            expect(bounds.x).toBeGreaterThanOrEqual(0);
            expect(bounds.y).toBeGreaterThanOrEqual(0);
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(paper.widthMm + 0.001);
            expect(bounds.y + bounds.height).toBeLessThanOrEqual(paper.heightMm + 0.001);
            expect(resized.widthMm).toBeGreaterThanOrEqual(0.5);
            expect(resized.fontSizeMm).toBeGreaterThanOrEqual(1.5);
          }
    },
  );
  it("also resizes barcode bounds without adding text font properties", () => {
    const barcode: LabelTemplateElement = { id: "barcode", kind: "barcode", xMm: 5, yMm: 5, widthMm: 20, heightMm: 10 };
    expect(resizeLabelElement(barcode, "se", 10, 0, paper, true)).toMatchObject({ widthMm: 30, heightMm: 15 });
    expect(resizeLabelElement(barcode, "s", 0, -100, paper, false).heightMm).toBe(0.5);
  });
});
