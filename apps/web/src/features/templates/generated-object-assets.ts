import {
  buildGeneratedObjectSvg,
  createGeneratedObjectSvgDataUrl,
  resolveGeneratedObjectType,
} from "examlist-template-editor/core";
import { renderSVG } from "uqr";

export type TemplateGeneratedObjectType = "barcode" | "qrcode";

export function createTemplateGeneratedObjectDataUrl(objectType: string, value: unknown): string {
  const resolvedType = resolveGeneratedObjectType(objectType) as TemplateGeneratedObjectType | "";
  if (!resolvedType) return "";

  const normalizedValue = String(value ?? "").trim() || "123100001";
  if (resolvedType === "qrcode") {
    const svg = renderSVG(normalizedValue, {
      blackColor: "#111827",
      border: 4,
      ecc: "M",
      pixelSize: 4,
      whiteColor: "#ffffff",
    });
    const naturalSize = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    const sizedSvg = naturalSize
      ? svg.replace("<svg ", `<svg width="${naturalSize[1]}" height="${naturalSize[2]}" `)
      : svg;

    return createGeneratedObjectSvgDataUrl(sizedSvg);
  }

  return createGeneratedObjectSvgDataUrl(buildGeneratedObjectSvg(resolvedType, normalizedValue));
}

export function buildTemplateEditorAssetUrl(path: string): string {
  const source = String(path || "").trim();
  if (!source) return "";

  try {
    const parsed = new URL(source, "http://examcheck.local");
    const match = /^\/api\/template-objects\/(barcode|qrcode)\.svg$/i.exec(parsed.pathname);

    if (match) {
      return createTemplateGeneratedObjectDataUrl(match[1], parsed.searchParams.get("value") || "123100001");
    }
  } catch {
    return source;
  }

  return source;
}
