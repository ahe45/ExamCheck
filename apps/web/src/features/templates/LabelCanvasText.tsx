import { useLayoutEffect, useState } from "react";
import type { LabelTemplateElement } from "../../shared/api/label-templates";

const ASCII_FONT = 'Arial, "Liberation Sans", sans-serif';
const UNICODE_FONT = '"Malgun Gothic", "Noto Sans CJK KR", "Arial Unicode MS", sans-serif';
const metricsCache = new Map<string, TextMetrics>();

/** Use glyph ink bounds, not the font's line/em box, for a tight label preview. */
export function LabelCanvasText({ text, element, dpi }: { text: string; element: LabelTemplateElement; dpi: number }) {
  const unicode = /[^\x20-\x7e]/.test(text);
  const family = unicode ? UNICODE_FONT : ASCII_FONT;
  const font = `${unicode ? 600 : 400} 100px ${family}`;
  const [metrics, setMetrics] = useState<TextMetrics | null>(null);
  const [capHeight, setCapHeight] = useState(72);
  useLayoutEffect(() => {
    if (typeof CanvasRenderingContext2D === "undefined") return;
    const measure = () => {
      const context = document.createElement("canvas").getContext("2d");
      if (!context) return;
      context.font = font;
      const key = `${font}\n${text}`;
      const measured = metricsCache.get(key) ?? context.measureText(text);
      if (metricsCache.size >= 512) metricsCache.clear();
      metricsCache.set(key, measured);
      setMetrics(measured);
      const caps = context.measureText("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ");
      setCapHeight(Math.max(1, caps.actualBoundingBoxAscent + caps.actualBoundingBoxDescent));
    };
    measure();
    const loaded = () => {
      metricsCache.clear();
      measure();
    };
    document.fonts?.addEventListener("loadingdone", loaded);
    return () => document.fonts?.removeEventListener("loadingdone", loaded);
  }, [font, text]);
  const requestedMm = (Math.max(8, Math.round(((element.fontSizeMm ?? 3) * dpi) / 25.4)) * 25.4) / dpi;
  const sizeMm = Math.min(requestedMm, element.heightMm);
  const viewWidth = (element.widthMm * 100) / sizeMm;
  const viewHeight = (element.heightMm * 100) / sizeMm;
  const ascent = metrics?.actualBoundingBoxAscent ?? 80;
  const descent = metrics?.actualBoundingBoxDescent ?? 20;
  const scaleY = 100 / Math.max(1, ascent + descent);
  const scaleX = unicode ? 1 : 100 / capHeight;
  const inkLeft = metrics?.actualBoundingBoxLeft ?? 0;
  const inkWidth = inkLeft + (metrics?.actualBoundingBoxRight ?? text.length * 60);
  const freeWidth = viewWidth / scaleX - inkWidth;
  const x = inkLeft + (element.align === "center" ? freeWidth / 2 : element.align === "right" ? freeWidth : 0);
  return (
    <svg
      className={`label-canvas-text ${unicode ? "label-canvas-text-unicode" : "label-canvas-text-printer"}`}
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      data-preview-text={text}
    >
      <text
        x={x}
        y={ascent}
        transform={`scale(${scaleX} ${scaleY})`}
        fontFamily={family}
        fontWeight={unicode ? 600 : 400}
        fontSize={100}
        fill="currentColor"
      >
        {text}
      </text>
    </svg>
  );
}
