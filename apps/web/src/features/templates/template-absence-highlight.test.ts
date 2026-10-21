// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderTemplateHtml } from "./template-renderer";
import { getPrintableCandidateGrid, renderCandidateGridPages } from "./template-candidate-pages";
import { serializeTemplateEditorHtml } from "./editor/template-editor-serialization";

const row =
  '<table><tbody><tr><td style="background-color:#ffffff">이름</td><td><span data-template-tag-value="candidate.absent"></span></td></tr><tr><td>다른 행</td><td>그대로</td></tr></tbody></table>';
const settings = { absenceHighlight: { enabled: true, color: "#fee2e2" } };
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("absence row highlighting", () => {
  it("shades every cell in the absent tag's row, while retaining other rows and present candidates", () => {
    const absent = parse(
      renderTemplateHtml({ settings: { ...settings, documentHtml: row } }, { "candidate.absent": "결시" }),
    );
    const cells = [...absent.querySelectorAll("tr:first-child > td")] as HTMLElement[];
    expect(cells.every((cell) => cell.style.backgroundColor === "rgb(254, 226, 226)")).toBe(true);
    expect(cells.every((cell) => cell.style.getPropertyPriority("background-color") === "important")).toBe(true);
    expect((absent.querySelector("tr:nth-child(2) > td") as HTMLElement).style.backgroundColor).toBe("");
    const present = parse(
      renderTemplateHtml({ settings: { ...settings, documentHtml: row } }, { "candidate.absent": "응시" }),
    );
    expect((present.querySelector("td") as HTMLElement).style.backgroundColor).toBe("rgb(255, 255, 255)");
  });

  it("does not shade when disabled or when the tag is outside a table", () => {
    const disabled = renderTemplateHtml(
      { settings: { documentHtml: row, absenceHighlight: { enabled: false, color: "#fee2e2" } } },
      { "candidate.absent": true },
    );
    expect(disabled).not.toContain("important");
    const outside = renderTemplateHtml(
      {
        settings: {
          ...settings,
          documentHtml:
            '<p><span data-template-tag-value="candidate.absent"></span></p><table><tr><td>본문</td></tr></table>',
        },
      },
      { "candidate.absent": "결시" },
    );
    expect(outside).not.toContain("important");
  });

  it("uses each record's attendance for repeated data blocks and leaves empty slots unshaded", () => {
    const template = {
      settings: {
        ...settings,
        candidateBlockGrid: { columns: 1, rows: 3, sortKey: "name" },
        documentHtml: `<div data-candidate-block-grid data-candidate-block-columns="1" data-candidate-block-rows="3">${Array.from({ length: 3 }, () => `<div data-candidate-block-instance>${row}</div>`).join("")}</div>`,
      },
    };
    const grid = getPrintableCandidateGrid(template)!;
    const output = parse(
      renderCandidateGridPages(grid, [
        { "candidate.name": "가", "candidate.absent": "응시" },
        { "candidate.name": "나", "candidate.absent": "결시" },
      ])[0],
    );
    const slots = [...output.querySelectorAll("[data-candidate-block-instance]")];
    expect((slots[0].querySelector("td") as HTMLElement).style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect((slots[1].querySelector("td") as HTMLElement).style.backgroundColor).toBe("rgb(254, 226, 226)");
    expect(slots[2].innerHTML).not.toContain("important");
  });

  it("removes editor preview markers before persisting HTML", () => {
    expect(
      serializeTemplateEditorHtml('<table><tr data-examcheck-absence-preview="true"><td>결시</td></tr></table>'),
    ).not.toContain("data-examcheck-absence-preview");
  });
});
