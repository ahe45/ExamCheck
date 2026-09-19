import { normalizeCandidateBlockGridConfig } from "examlist-template-editor/core";
import type { TemplateEditorValue } from "../../shared/templates/template-editor-contracts";
import { serializeTemplateEditorHtml } from "./editor/template-editor-serialization";
import { getTemplateDocumentHtml, getTemplatePageSettings, renderTemplateHtml } from "./template-renderer";

type Values = Record<string, unknown>;

export function getPrintableCandidateGrid(template: TemplateEditorValue) {
  const html = serializeTemplateEditorHtml(getTemplateDocumentHtml(template));
  const root = new DOMParser().parseFromString(html, "text/html").body;
  const grid = root.querySelector<HTMLElement>("[data-candidate-block-grid]");
  if (!grid) return null;
  const config = normalizeCandidateBlockGridConfig(getTemplatePageSettings(template).candidateBlockGrid);
  const columns = Number(grid.dataset.candidateBlockColumns) || config.columns;
  const rows = Number(grid.dataset.candidateBlockRows) || config.rows;
  const blocks = [...grid.querySelectorAll<HTMLElement>("[data-candidate-block-instance]")];
  const capacity = columns * rows;
  if (!Number.isInteger(capacity) || capacity < 1 || blocks.length !== capacity) {
    throw new Error(
      "양식의 수험생 데이터 블록 수와 행·열 설정이 일치하지 않습니다. 양식 편집기에서 데이터 블록을 확인하고 저장해 주세요.",
    );
  }
  return { html, config, capacity, blocks };
}

// Sort keys belong to the editor; values belong to the application's tag projection.
const sortTags: Record<string, string> = {
  track: "examName",
  admission: "admissionTypeName",
  admissionCode: "admissionTypeCode",
  series: "seriesName",
  seriesCode: "seriesCode",
  unit: "departmentName",
  unitCode: "departmentCode",
  major: "majorName",
  majorCode: "majorCode",
  date: "examDate",
  time: "examStartTime",
  endTime: "examEndTime",
  period: "periodName",
  periodCode: "periodCode",
  building: "buildingName",
  buildingCode: "buildingCode",
  room: "roomName",
  roomCode: "roomCode",
  examineeNo: "examNo",
  temporaryNo: "temporaryNo",
  name: "name",
  birth: "birthDate",
  group: "groupName",
};

export function renderCandidateGridPages(
  grid: NonNullable<ReturnType<typeof getPrintableCandidateGrid>>,
  records: Values[],
) {
  const sorted = sortCandidateGridRecords(grid, records);
  const pages: string[] = [];
  for (let offset = 0; offset < sorted.length; offset += grid.capacity) {
    const pageRecords = sorted.slice(offset, offset + grid.capacity);
    // Render the surrounding document once, then project each saved slot separately.
    // Keep the fixed grid tracks, header and footer, including on a partially filled page.
    const root = new DOMParser().parseFromString(renderTemplateHtml(grid.html, pageRecords[0]), "text/html").body;
    const slots = root.querySelectorAll<HTMLElement>("[data-candidate-block-grid] [data-candidate-block-instance]");
    slots.forEach((slot, index) => {
      const values = pageRecords[index];
      if (values) {
        slot.innerHTML = renderTemplateHtml(grid.blocks[index].innerHTML, { ...values, "row.indexInPage": index + 1 });
      } else {
        slot.innerHTML = grid.config.fillEmptyBlocks
          ? renderTemplateHtml(
              grid.config.emptyBlockLayer.enabled
                ? grid.config.emptyBlockLayer.templateHtml
                : grid.blocks[index].innerHTML,
              Object.fromEntries(Object.keys(pageRecords[0]).map((key) => [key, ""])),
            )
          : "";
        if (!grid.config.fillEmptyBlocks) slot.style.visibility = "hidden";
      }
    });
    pages.push(root.innerHTML);
  }
  return pages;
}

export function sortCandidateGridRecords<T extends Values>(
  grid: NonNullable<ReturnType<typeof getPrintableCandidateGrid>>,
  records: T[],
) {
  const key = `candidate.${sortTags[grid.config.sortKey] || grid.config.sortKey}`;
  const direction = grid.config.sortDirection === "desc" ? -1 : 1;
  const collator = new Intl.Collator("ko", { numeric: true });
  return [...records].sort((a, b) => direction * collator.compare(String(a[key] ?? ""), String(b[key] ?? "")));
}
