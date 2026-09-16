// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { getTemplatePrintPresentation } from "./template-print-presentation";

describe("template print paper settings", () => {
  it("uses the canvas paper size, orientation and each margin", () => {
    const result = getTemplatePrintPresentation(`<div class="template-doc" data-template-page-size="A3"
      data-template-page-orientation="landscape" data-template-page-margin-top="0"
      data-template-page-margin-right="5" data-template-page-margin-bottom="10"
      data-template-page-margin-left="15"></div>`);
    expect(result.width).toBe(1587);
    expect(result.height).toBe(1123);
    expect(result.css).toContain("padding: 0px 19px 38px 57px");
    expect(result.css).toContain("@page { size: 1587px 1123px; margin: 0; }");
  });

  it("keeps the default A4 paper and margins for older markup", () => {
    const result = getTemplatePrintPresentation("<p>양식</p>");
    expect(result.width).toBe(794);
    expect(result.height).toBe(1123);
    expect(result.css).toContain("padding: 38px 38px 38px 38px");
  });
});
