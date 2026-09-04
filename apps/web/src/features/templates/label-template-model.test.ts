import { describe, expect, it } from "vitest";
import {
  clampLabelElement,
  cloneLabelLayout,
  createLabelElement,
  defaultLabelLayout,
  replaceLabelSamples,
} from "./label-template-model";

describe("label template model", () => {
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
