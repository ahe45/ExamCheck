import { describe, expect, it } from "vitest";
import {
  clampLabelElement,
  cloneLabelLayout,
  createLabelElement,
  defaultLabelLayout,
  labelElementTransform,
  replaceLabelSamples,
  rotateLabelElement,
} from "./label-template-model";
import { labelElementBounds } from "./label-element-alignment";

describe("label template model", () => {
  it.each([0, 90, 180, 270] as const)("%s° 개체를 양방향으로 회전해도 중심과 크기를 유지한다", (rotation) => {
    const element = { id: "rotate", kind: "box" as const, xMm: 25, yMm: 15, widthMm: 20, heightMm: 10, rotation };
    const original = labelElementBounds(element);
    for (const delta of [-90, 90] as const) {
      const rotated = rotateLabelElement(element, delta, defaultLabelLayout);
      const bounds = labelElementBounds(rotated);
      expect(bounds.x + bounds.width / 2).toBe(original.x + original.width / 2);
      expect(bounds.y + bounds.height / 2).toBe(original.y + original.height / 2);
      expect(rotated).toMatchObject({ widthMm: 20, heightMm: 10, rotation: (rotation + delta + 360) % 360 });
      expect(rotateLabelElement(rotated, delta === 90 ? -90 : 90, defaultLabelLayout)).toEqual(element);
      let fullTurn = element;
      for (let turn = 0; turn < 4; turn++)
        fullTurn = rotateLabelElement(fullTurn, delta, defaultLabelLayout) as typeof element;
      expect(fullTurn).toEqual(element);
    }
  });

  it("중심 회전 후 경계를 벗어난 축만 용지 안으로 보정한다", () => {
    expect(
      rotateLabelElement(
        { id: "edge", kind: "box", xMm: 4, yMm: 1, widthMm: 30, heightMm: 10 },
        90,
        defaultLabelLayout,
      ),
    ).toMatchObject({ xMm: 14, yMm: 0, widthMm: 30, heightMm: 10, rotation: 90 });
  });

  it.each([90, 270] as const)("%s° 회전 개체의 이동과 크기를 회전 후 경계로 제한한다", (rotation) => {
    const element = { id: "rotated", kind: "box" as const, xMm: 70, yMm: 40, widthMm: 30, heightMm: 10, rotation };
    expect(clampLabelElement(element, defaultLabelLayout)).toMatchObject({
      xMm: 65,
      yMm: 15,
      widthMm: 30,
      heightMm: 10,
      rotation,
    });
    expect(clampLabelElement({ ...element, widthMm: 100, heightMm: 100 }, defaultLabelLayout)).toMatchObject({
      xMm: 0,
      yMm: 0,
      widthMm: 45,
      heightMm: 75,
    });
  });

  it("회전된 개체의 왼쪽 위 위치를 유지하는 미리보기 변환을 제공한다", () => {
    expect(labelElementTransform(undefined)).toBeUndefined();
    expect(labelElementTransform(0)).toBeUndefined();
    expect(labelElementTransform(90)).toBe("rotate(90deg) translateY(-100%)");
    expect(labelElementTransform(180)).toBe("rotate(180deg) translate(-100%, -100%)");
    expect(labelElementTransform(270)).toBe("rotate(270deg) translateX(-100%)");
  });

  it("요소 형식별 기본값을 만들고 서로 다른 편집 사본을 제공한다", () => {
    expect(createLabelElement("text", 1)).toMatchObject({ id: "text-1", kind: "text", content: "텍스트" });
    expect(createLabelElement("barcode", 2)).toMatchObject({
      id: "barcode-2",
      kind: "barcode",
      content: "{{candidate.temporaryNo}}",
    });

    const clone = cloneLabelLayout(defaultLabelLayout);
    clone.elements[0]!.xMm = 20;
    expect(defaultLabelLayout.elements[0]!.xMm).toBe(4);
    expect(
      cloneLabelLayout({
        ...defaultLabelLayout,
        elements: [{ ...defaultLabelLayout.elements[0]!, content: "{{PSEUDONYM_NO}} / {{EXAMINEE_NO}}" }],
      }).elements[0]?.content,
    ).toBe("{{candidate.temporaryNo}} / {{candidate.examNo}}");
  });

  it("요소를 라벨 출력 영역 안으로 제한한다", () => {
    expect(
      clampLabelElement({ id: "box", kind: "box", xMm: 70, yMm: -2, widthMm: 20, heightMm: 60 }, defaultLabelLayout),
    ).toMatchObject({ xMm: 55, yMm: 0, widthMm: 20, heightMm: 45 });
  });

  it("데이터 태그를 미리보기 샘플 값으로 치환한다", () => {
    expect(
      replaceLabelSamples("{{candidate.temporaryNo}} / {{candidate.examNo}}", [
        { key: "candidate.temporaryNo", label: "가번호", example: "1501" },
        { key: "candidate.examNo", label: "수험번호", example: "20260001" },
      ]),
    ).toBe("1501 / 20260001");
    expect(
      replaceLabelSamples(
        "{{candidate.temporaryNo}}",
        [{ key: "candidate.temporaryNo", label: "가번호", example: "1501" }],
        false,
      ),
    ).toBe("#가번호");
  });
});
