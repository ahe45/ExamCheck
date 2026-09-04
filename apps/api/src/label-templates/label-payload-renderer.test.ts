import { describe, expect, it } from "vitest";
import { renderLabelPayload } from "./label-payload-renderer.js";
import { toLabelTemplateZplValues } from "./label-template-layout.js";

const layout = {
  widthMm: 75,
  heightMm: 45,
  dpi: 203,
  elements: [
    {
      id: "korean",
      kind: "text",
      xMm: 4,
      yMm: 3,
      widthMm: 67,
      heightMm: 8,
      content: "수험생: {{candidate.name}}",
      fontSizeMm: 4,
      align: "center",
    },
    {
      id: "number",
      kind: "text",
      xMm: 4,
      yMm: 14,
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
      yMm: 28,
      widthMm: 59,
      heightMm: 12,
      content: "{{candidate.examNo}}",
      showText: true,
    },
  ],
};

describe("renderLabelPayload", () => {
  it("한글 텍스트를 프린터 폰트와 무관한 흑백 그래픽으로 변환한다", async () => {
    const payload = await renderLabelPayload(
      layout,
      toLabelTemplateZplValues({
        "candidate.name": "김수험",
        "candidate.temporaryNo": "01",
        "candidate.examNo": "20260001",
      }),
    );

    expect(payload).toMatch(/^\^XA\^CI28/);
    expect(payload).toContain("^GFA,");
    expect(payload).not.toContain("수험생");
    expect(payload).not.toContain("김수험");
    expect(payload).toContain("^FD01^FS");
    expect(payload).toContain("^FD20260001^FS");
    expect(payload).toMatch(/\^GFA,\d+,\d+,\d+,[0-9A-F]+\^FS/);
    expect(payload).toMatch(/\^XZ$/);
  });

  it("ZPL 제어문자를 데이터 값에서 제거한다", async () => {
    const payload = await renderLabelPayload(
      { ...layout, elements: [layout.elements[1]] },
      toLabelTemplateZplValues({ "candidate.temporaryNo": "01^XZ~JA" }),
    );

    expect(payload).toContain("^FD01 XZ JA^FS");
    expect(payload.match(/\^XZ/g)).toHaveLength(1);
  });
});
