import { describe, expect, it } from "vitest";
import { encode } from "uqr";
import { buildTemplateEditorAssetUrl, createTemplateGeneratedObjectDataUrl } from "./generated-object-assets";

describe("generated template object assets", () => {
  it.each(["barcode", "qrcode"])("creates an inline SVG for %s", (objectType) => {
    const source = createTemplateGeneratedObjectDataUrl(objectType, "240001");
    const svg = decodeURIComponent(source);
    const otherValueSource = createTemplateGeneratedObjectDataUrl(objectType, "240002");

    expect(source).toMatch(/^data:image\/svg\+xml;charset=UTF-8,/);
    expect(svg).toContain("<svg");
    expect(source).not.toBe(otherValueSource);
  });

  it("converts generated-object API paths while preserving unrelated assets", () => {
    const barcode = buildTemplateEditorAssetUrl("/api/template-objects/barcode.svg?value=240001");

    expect(barcode).toMatch(/^data:image\/svg\+xml/);
    expect(buildTemplateEditorAssetUrl("/uploads/photo.png")).toBe("/uploads/photo.png");
  });

  it("encodes the source value in a complete Code128 sequence", () => {
    const svg = decodeURIComponent(createTemplateGeneratedObjectDataUrl("barcode", "240001"));

    expect(svg).toContain('data-code128-format="code128"');
    expect(svg).toContain('data-code128-value="240001"');
    expect(svg).toMatch(/data-code128-sequence="104,[\d,]+,106"/);
  });

  it("rejects unknown generated object types", () => {
    expect(createTemplateGeneratedObjectDataUrl("unknown", "240001")).toBe("");
  });

  it("uses a standards-based QR matrix with a four-module quiet zone", () => {
    const encoded = encode("240001", { border: 4, ecc: "M" });
    const svg = decodeURIComponent(createTemplateGeneratedObjectDataUrl("qrcode", "240001"));

    expect(encoded.version).toBeGreaterThanOrEqual(1);
    expect(encoded.data).toHaveLength(encoded.size);
    expect(encoded.data.every((row) => row.length === encoded.size)).toBe(true);
    expect(svg).toContain(`width="${encoded.size * 4}" height="${encoded.size * 4}"`);
    expect(svg).toContain(`viewBox="0 0 ${encoded.size * 4} ${encoded.size * 4}"`);
  });
});
