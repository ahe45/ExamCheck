import { describe, expect, it } from "vitest";
import type { LabelTemplateLayout } from "../../shared/api/label-templates";
import {
  alignLabelElements,
  labelElementBounds,
  moveLabelElements,
  type LabelAlignment,
} from "./label-element-alignment";

const layout: LabelTemplateLayout = {
  widthMm: 100,
  heightMm: 60,
  dpi: 203,
  elements: [
    { id: "a", kind: "box", xMm: 5, yMm: 2, widthMm: 10, heightMm: 4 },
    { id: "b", kind: "text", xMm: 25, yMm: 18, widthMm: 12, heightMm: 4, rotation: 90, content: "회전" },
    { id: "c", kind: "barcode", xMm: 65, yMm: 45, widthMm: 8, heightMm: 8, content: "1234" },
  ],
};

describe("label object alignment", () => {
  it.each<[LabelAlignment, number, number]>([
    ["left", -5, 0],
    ["center-x", 33, 0],
    ["right", 71, 0],
    ["top", 0, -2],
    ["center-y", 0, 14],
    ["bottom", 0, 30],
  ])("다중 개체 용지 %s 맞춤은 묶음의 배치와 회전을 보존한다", (command, dx, dy) => {
    const result = alignLabelElements(layout, ["a", "b"], command, "paper");
    for (const index of [0, 1]) {
      const original = layout.elements[index]!;
      expect(result.elements[index]).toEqual({ ...original, xMm: original.xMm + dx, yMm: original.yMm + dy });
    }
    expect(result.elements[2]).toBe(layout.elements[2]);
  });

  it("3개 개체의 세로 가운데 맞춤은 전체 높이의 중심을 용지 중심으로 이동한다", () => {
    const result = alignLabelElements(layout, ["a", "b", "c"], "center-y", "paper");
    expect(result.elements.map((element) => [element.xMm, element.yMm])).toEqual([
      [5, 4.5],
      [25, 20.5],
      [65, 47.5],
    ]);
    const bounds = result.elements.map(labelElementBounds);
    expect(
      (Math.min(...bounds.map((item) => item.y)) + Math.max(...bounds.map((item) => item.y + item.height))) / 2,
    ).toBe(layout.heightMm / 2);
    expect(alignLabelElements(result, ["a", "b", "c"], "center-y", "paper")).toBe(result);
  });

  it.each<[LabelAlignment, number, number]>([
    ["left", 0, 18],
    ["center-x", 48, 18],
    ["right", 96, 18],
    ["top", 25, 0],
    ["center-y", 25, 24],
    ["bottom", 25, 48],
  ])("용지 %s 맞춤은 회전된 크기를 기준으로 위치만 변경한다", (command, xMm, yMm) => {
    const result = alignLabelElements(layout, ["b"], command, "paper");
    expect(result.elements[1]).toEqual({ ...layout.elements[1], xMm, yMm });
    expect(result.elements[0]).toBe(layout.elements[0]);
    expect(result.elements[2]).toBe(layout.elements[2]);
  });

  it.each<LabelAlignment>(["left", "center-x", "right", "top", "center-y", "bottom"])(
    "선택 개체끼리 %s 위치를 일치시킨다",
    (command) => {
      const result = alignLabelElements(layout, ["a", "b"], command, "selection");
      const [a, b] = result.elements.slice(0, 2).map(labelElementBounds);
      const horizontal = ["left", "center-x", "right"].includes(command);
      const factor = command.includes("center") ? 0.5 : ["right", "bottom"].includes(command) ? 1 : 0;
      expect(horizontal ? a!.x + factor * a!.width : a!.y + factor * a!.height).toBeCloseTo(
        horizontal ? b!.x + factor * b!.width : b!.y + factor * b!.height,
        1,
      );
      expect(result.elements[2]).toBe(layout.elements[2]);
      expect(layout.elements[1]?.xMm).toBe(25);
    },
  );

  it.each(["distribute-x", "distribute-y"] as const)(
    "%s는 바깥 개체를 유지하고 회전된 개체의 가장자리 간격을 같게 만든다",
    (command) => {
      const result = alignLabelElements(layout, ["c", "a", "b"], command, "paper");
      const [a, b, c] = result.elements.map(labelElementBounds);
      if (command === "distribute-x") {
        expect(b!.x - a!.x - a!.width).toBeCloseTo(c!.x - b!.x - b!.width, 1);
        expect(result.elements[1]?.xMm).toBe(38);
      } else {
        expect(b!.y - a!.y - a!.height).toBeCloseTo(c!.y - b!.y - b!.height, 1);
        expect(result.elements[1]?.yMm).toBe(19.5);
      }
      expect(result.elements[0]).toEqual(layout.elements[0]);
      expect(result.elements[2]).toEqual(layout.elements[2]);
    },
  );

  it("선택 개수가 부족하거나 간격 확보가 불가능하면 배치를 변경하지 않는다", () => {
    expect(alignLabelElements(layout, [], "left", "paper")).toBe(layout);
    expect(alignLabelElements(layout, ["a"], "left", "selection")).toBe(layout);
    expect(alignLabelElements(layout, ["a", "b"], "distribute-x", "selection")).toBe(layout);
    const overlapping = { ...layout, elements: layout.elements.map((element) => ({ ...element, xMm: 0 })) };
    expect(alignLabelElements(overlapping, ["a", "b", "c"], "distribute-x", "selection")).toBe(overlapping);
  });

  it("그룹 이동은 용지 경계에서 멈추면서 개체 사이의 거리와 회전을 보존한다", () => {
    const result = moveLabelElements(layout, ["a", "b", "c"], 200, 200);
    expect(result.elements.map((element) => [element.xMm, element.yMm])).toEqual([
      [32, 9],
      [52, 25],
      [92, 52],
    ]);
    const back = moveLabelElements(result, ["a", "b", "c"], -200, -200);
    expect(back.elements.map((element) => [element.xMm, element.yMm])).toEqual([
      [0, 0],
      [20, 16],
      [60, 43],
    ]);
    expect(back.elements[1]?.rotation).toBe(90);
  });
});
