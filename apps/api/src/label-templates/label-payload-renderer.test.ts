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
  it.each([203, 300])("%s dpi 한글 그래픽을 실제 픽셀 단위로 회전하며 캐시가 각도를 구분한다", async (dpi) => {
    const element = { ...layout.elements[0], widthMm: 20, heightMm: 8, content: "한글 A", align: "left" };
    const width = Math.round((20 * dpi) / 25.4);
    const height = Math.round((8 * dpi) / 25.4);
    async function pixels(rotation: number) {
      const payload = await renderLabelPayload({ ...layout, dpi, elements: [{ ...element, rotation }] }, {});
      expect(payload).toContain("^FO");
      const match = /\^GFA,(\d+),\d+,(\d+),([0-9A-F]+)\^FS/.exec(payload)!;
      const stride = Number(match[2]);
      const bytes = Buffer.from(match[3]!, "hex");
      const sideways = rotation === 90 || rotation === 270;
      expect(stride).toBe(Math.ceil((sideways ? height : width) / 8));
      expect(Number(match[1])).toBe(stride * (sideways ? width : height));
      return (x: number, y: number) => Boolean(bytes[y * stride + Math.floor(x / 8)]! & (0x80 >> (x % 8)));
    }
    const original = await pixels(0);
    for (const rotation of [90, 180, 270]) {
      const rotated = await pixels(rotation);
      let blackPixels = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const expected = original(x, y);
          if (expected) blackPixels++;
          const rx = rotation === 90 ? height - 1 - y : rotation === 180 ? width - 1 - x : y;
          const ry = rotation === 90 ? x : rotation === 180 ? height - 1 - y : width - 1 - x;
          expect(rotated(rx, ry)).toBe(expected);
        }
      }
      expect(blackPixels).toBeGreaterThan(0);
    }
  });

  it.each([
    [90, "R"],
    [270, "B"],
  ])("%s° 텍스트·바코드 출력에 샘플 데이터를 치환한다", async (rotation, orientation) => {
    const elements = [layout.elements[1], layout.elements[2]].map((element) => ({
      ...element,
      xMm: 4,
      yMm: 3,
      widthMm: 30,
      heightMm: 8,
      rotation,
    }));
    const payload = await renderLabelPayload(
      { ...layout, elements },
      toLabelTemplateZplValues({
        "candidate.temporaryNo": "15",
        "candidate.examNo": "20260001",
      }),
    );
    expect(payload).toContain(`^A0${orientation},`);
    expect(payload).toContain(`^BC${orientation},`);
    expect(payload).toContain("^FD15^FS");
    expect(payload).toContain("^FD20260001^FS");
  });

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
