import editorStyles from "examlist-template-editor/styles.css?inline";
import {
  examListPaperPresetByRuntimeSize,
  paperPresetDimensionsPt,
  readRuntimePageSettingsFromHtml,
} from "examlist-template-editor/core";

// Keep this rule inside the SVG capture as well: html2canvas copies computed
// pixel widths, which otherwise become stale when embedded fonts are rendered.
export const templatePrintTokenFlowCss = `
  .print-document .template-doc .template-token:not(img) {
    width: auto !important; min-width: 0 !important; max-width: 100% !important;
    white-space: normal !important;
    /* Badge gutters are editor affordances, not spaces in the document.
       Keep vertical box metrics so removing them cannot change row spacing. */
    padding-left: 0 !important; padding-right: 0 !important;
    border-left-width: 0 !important; border-right-width: 0 !important;
    margin-left: 0 !important; margin-right: 0 !important;
  }
`;

// Use the editor's document rules so grid tracks, table cells and text have
// the same geometry. Only the editing guides are made invisible.
export function getTemplatePrintPresentation(html: string) {
  const settings = readRuntimePageSettingsFromHtml(html);
  const preset = Object.entries(examListPaperPresetByRuntimeSize).find(([size]) => size === settings.size)?.[1] || "A4";
  const paper = paperPresetDimensionsPt[preset];
  const landscape = settings.orientation === "landscape";
  const width = Math.round(((landscape ? paper.heightPt : paper.widthPt) * 4) / 3);
  const height = Math.round(((landscape ? paper.widthPt : paper.heightPt) * 4) / 3);
  const documentElement = new DOMParser().parseFromString(html, "text/html").querySelector(".template-doc");
  const margins = ["top", "right", "bottom", "left"].map((side) => {
    const raw = documentElement?.getAttribute(`data-template-page-margin-${side}`);
    const value = raw == null ? 10 : Number(raw);
    return Math.round((Math.max(0, Number.isFinite(value) ? value : 10) * 96) / 25.4);
  });
  const css = `${editorStyles}
    @page { size: ${width}px ${height}px; margin: 0; }
    .print-toolbar { z-index: 1; }
    .examlist-template-editor.print-document {
      position: relative; z-index: 0;
      width: ${width}px; min-height: ${height}px; margin: 0 auto;
      padding: ${margins.map((value) => `${value}px`).join(" ")};
      background: white; color: black; overflow: visible;
    }
    .print-document .editor-document-surface { min-height: ${height - margins[0] - margins[2]}px; }
    .print-document .editor-document-surface .template-doc,
    .print-document .editor-document-surface .examlist-candidate-block,
    .print-document .template-doc .template-token {
      border-color: transparent !important; box-shadow: none !important; outline: none !important;
    }
    .print-document .template-doc .template-token {
      background: transparent; white-space: normal; gap: 0;
    }
    /* Preserve the editor's inline box metrics so paragraph baselines and
       spacing to positioned objects stay unchanged. */
    ${templatePrintTokenFlowCss}
    .print-document .template-token > svg,
    .print-document .template-token::after { display: none !important; }
    .print-document .editor-document-surface .examlist-candidate-block-grid { cursor: default; }
    @media print {
      .print-toolbar { display: none; }
      .examlist-template-editor.print-document { margin: 0; }
    }
  `;
  return { css, width, height };
}
