import { describe, expect, it } from "vitest";
import {
  buildLabelZpl,
  defaultLabelTemplateLayout,
  labelTemplateSampleValues,
  parseLabelTemplateLayout,
  type LabelTemplateElement,
  toLabelTemplateZplValues,
} from "./label-template-layout.js";

describe("label template layout", () => {
  it.each([11, 20, 48])("%spt 글자 크기가 반복 저장 후에도 유지된다", (points) => {
    const original = {
      ...defaultLabelTemplateLayout,
      elements: [{ ...defaultLabelTemplateLayout.elements[0], fontSizeMm: (points * 25.4) / 72 }],
    };
    const saved = parseLabelTemplateLayout(original);
    const reopened = parseLabelTemplateLayout(JSON.stringify(saved));
    expect((reopened.elements[0]!.fontSizeMm! * 72) / 25.4).toBeCloseTo(points, 4);
    expect(reopened).toEqual(saved);
  });
  it.each([0, 90, 180, 270] as const)("%s° 회전값을 저장하고 텍스트와 바코드 출력 방향에 적용한다", (rotation) => {
    const orientation = { 0: "N", 90: "R", 180: "I", 270: "B" }[rotation];
    const elements: LabelTemplateElement[] = ["text", "barcode"].map((kind, index) => ({
      id: `element-${index}`,
      kind: kind as "text" | "barcode",
      xMm: 4,
      yMm: 3,
      widthMm: 30,
      heightMm: 8,
      content: "1234",
      rotation,
    }));
    const result = buildLabelZpl({ ...defaultLabelTemplateLayout, elements });
    expect(result.layout.elements.map((element) => element.rotation)).toEqual([rotation, rotation]);
    expect(result.zplTemplate).toContain(`^FO32,24^A0${orientation},`);
    expect(result.zplTemplate).toContain(`^BC${orientation},64,Y,N,N^FD1234^FS`);
  });

  it.each([-90, 45, 90.01, 360, "90", null])("지원하지 않는 회전값 %s를 거부한다", (rotation) => {
    expect(() =>
      parseLabelTemplateLayout({
        ...defaultLabelTemplateLayout,
        elements: [{ ...defaultLabelTemplateLayout.elements[0], rotation }],
      }),
    ).toThrow("회전 각도");
  });

  it("회전 후 영역을 기준으로 넘치는 요소를 거부하고 세로로 배치 가능한 요소를 허용한다", () => {
    const element = { id: "rotated", kind: "box", xMm: 60, yMm: 2, widthMm: 40, heightMm: 10, rotation: 90 };
    expect(parseLabelTemplateLayout({ ...defaultLabelTemplateLayout, elements: [element] }).elements[0]).toMatchObject(
      element,
    );
    expect(() =>
      parseLabelTemplateLayout({ ...defaultLabelTemplateLayout, elements: [{ ...element, xMm: 0, yMm: 10 }] }),
    ).toThrow("출력 영역");
  });

  it.each([
    [0, "^FO32,24^GB160,8,8,B,0", "^GB160,64,8,B,0"],
    [90, "^FO88,24^GB8,160,8,B,0", "^GB64,160,8,B,0"],
    [180, "^FO32,80^GB160,8,8,B,0", "^GB160,64,8,B,0"],
    [270, "^FO32,24^GB8,160,8,B,0", "^GB64,160,8,B,0"],
  ])("%s° 회전한 선과 사각형의 위치와 치수를 출력한다", (rotation, line, box) => {
    const elements = ["line", "box"].map((kind) => ({
      id: kind,
      kind,
      xMm: 4,
      yMm: 3,
      widthMm: 20,
      heightMm: 8,
      strokeWidthMm: 1,
      rotation,
    }));
    const { zplTemplate } = buildLabelZpl({ ...defaultLabelTemplateLayout, elements });
    expect(zplTemplate).toContain(line);
    expect(zplTemplate).toContain(box);
  });

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
