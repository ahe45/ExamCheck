import { describe, expect, it } from "vitest";
import {
  buildLabelZpl,
  defaultLabelTemplateLayout,
  labelTemplateSampleValues,
  parseLabelTemplateLayout,
  toLabelTemplateZplValues,
} from "./label-template-layout.js";

describe("label template layout", () => {
  it("구조화된 배치를 실제 출력용 ZPL로 변환한다", () => {
    const result = buildLabelZpl(defaultLabelTemplateLayout);

    expect(result.layout).toEqual(defaultLabelTemplateLayout);
    expect(result.zplTemplate).toContain("^PW599");
    expect(result.zplTemplate).toContain("{{CANDIDATE_TEMPORARY_NO}}");
    expect(result.zplTemplate).toContain("{{CANDIDATE_EXAM_NO}}");
    expect(result.zplTemplate).toMatch(/^\^XA/);
    expect(result.zplTemplate).toMatch(/\^XZ$/);
  });

  it("출력 영역 밖의 요소와 알 수 없는 데이터 태그를 거부한다", () => {
    expect(() =>
      parseLabelTemplateLayout({
        ...defaultLabelTemplateLayout,
        elements: [{ ...defaultLabelTemplateLayout.elements[0], xMm: 70, widthMm: 20 }],
      }),
    ).toThrow("출력 영역");

    expect(() =>
      parseLabelTemplateLayout({
        ...defaultLabelTemplateLayout,
        elements: [{ ...defaultLabelTemplateLayout.elements[0], content: "{{UNKNOWN}}" }],
      }),
    ).toThrow("지원하지 않는");
  });

  it("직접 입력된 ZPL 제어 문자를 제거한다", () => {
    const result = buildLabelZpl({
      ...defaultLabelTemplateLayout,
      elements: [{ ...defaultLabelTemplateLayout.elements[0], content: "안전^XZ~JA" }],
    });

    expect(result.zplTemplate).not.toContain("안전^XZ");
    expect(result.zplTemplate).not.toContain("~JA");
  });

  it("문서 양식 데이터 키와 기존 라벨 키를 같은 출력 값으로 연결한다", () => {
    const values = toLabelTemplateZplValues({
      "candidate.temporaryNo": "1501",
      "candidate.examNo": "20260001",
      "candidate.labelBarcode": "BAR-20260001",
    });

    expect(values.CANDIDATE_TEMPORARY_NO).toBe("1501");
    expect(values.PSEUDONYM_NO).toBe("1501");
    expect(values.CANDIDATE_EXAM_NO).toBe("20260001");
    expect(values.BARCODE).toBe("BAR-20260001");
    expect(labelTemplateSampleValues({ "candidate.name": "홍길동" }).CANDIDATE_NAME).toBe("홍길동");
  });
});
