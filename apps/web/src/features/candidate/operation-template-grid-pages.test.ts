// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { FormTemplate } from "../../shared/api/form-templates";
import type { OperationRow } from "./operation-view-model";
import { buildOperationTemplatePages, type OperationTemplateContext } from "./operation-template-pages";

const photos = vi.hoisted(() => vi.fn());
vi.mock("../../shared/api/examinees", async (original) => ({
  ...(await original<typeof import("../../shared/api/examinees")>()),
  fetchExamineePhoto: photos,
}));

const context = {
  token: "test",
  systemProfile: { schoolName: "학교", academicYear: 2026, systemName: "시험" },
  schedule: { date: "2026-10-30", time: "10:00", periodName: "오전", admissionName: "면접" },
  examName: "면접",
  operationClosed: true,
  signatureNames: { "signature.author": "작성자", "signature.reviewer": "확인자" },
} as OperationTemplateContext;

function row(index: number): OperationRow {
  return {
    candidate: {
      examineeNo: String(1000 + index),
      name: `수험생 ${index}`,
      birthDate: "2000-01-01",
      buildingName: "본관",
      roomName: "101호",
    },
    assignment: index % 2 ? { pseudonymNumber: String(index) } : null,
  } as OperationRow;
}

function fixture(columns = 1, rows = 20, fillEmptyBlocks = false, sortDirection = "asc") {
  const block =
    '<table style="width:300px;height:30px"><tr><td>{{row.indexInPage}}</td><td>{{candidate.examNo}}</td><td>{{candidate.temporaryNo}}</td><td>{{candidate.absent}}</td><td><img data-template-tag-value="candidate.photo"></td></tr></table>';
  const html =
    '<div class="template-doc"><h1>가번호 부여대장</h1><div data-candidate-block-grid="true" data-candidate-block-columns="' +
    columns +
    '" data-candidate-block-rows="' +
    rows +
    '" style="position:absolute;top:100px;width:600px;height:600px">' +
    '<div data-candidate-block-column-name="true">번호 / 수험번호</div>' +
    Array.from(
      { length: columns * rows },
      (_, i) => '<div data-candidate-block-instance="' + (i + 1) + '">' + block + "</div>",
    ).join("") +
    '</div><table style="position:absolute;top:1011px"><tr><td>{{signature.author}}</td></tr></table></div>';
  return {
    usageScope: "CANDIDATE",
    id: 1,
    code: "GRID_TEST",
    name: "가번호 부여대장",
    description: null,
    category: "문서",
    active: true,
    createdAt: "2026-09-09",
    createdByLoginId: "admin",
    layout: {
      layout: {
        pages: [
          {
            type: "content",
            settings: {
              documentHtml: html,
              candidateBlockGrid: { columns, rows, fillEmptyBlocks, sortKey: "examineeNo", sortDirection },
            },
          },
        ],
      },
    },
  } satisfies FormTemplate;
}

function slots(html: string) {
  return [
    ...new DOMParser()
      .parseFromString(html, "text/html")
      .querySelectorAll<HTMLElement>("[data-candidate-block-instance]"),
  ];
}

describe("operation document candidate grid pagination", () => {
  it.each([
    [1, 1],
    [20, 1],
    [21, 2],
    [30, 2],
    [40, 2],
  ])("%i명을 20행 양식의 %i페이지에 누락·중복 없이 배치한다", async (count, pageCount) => {
    photos.mockResolvedValue(null);
    const rows = Array.from({ length: count }, (_, i) => row(i + 1));
    const pages = await buildOperationTemplatePages(fixture(), rows, context);
    expect(pages).toHaveLength(pageCount);
    const printed = pages.flatMap((html) => slots(html).filter((slot) => slot.style.visibility !== "hidden"));
    expect(printed.map((slot) => slot.querySelectorAll("td")[1].textContent)).toEqual(
      rows.map((row) => row.candidate.examineeNo),
    );
    expect(printed[0].querySelectorAll("td")[2].textContent).toBe("1");
    if (count > 1) expect(printed[1].querySelectorAll("td")[3].textContent).toBe("결시");
    expect(pages.every((html) => html.includes("top:1011px") && html.includes("작성자"))).toBe(true);
    expect(photos).toHaveBeenCalledTimes(count);
  });

  it("2열×10행, 내림차순과 빈 블록 표시 설정을 반영한다", async () => {
    photos.mockResolvedValue(null);
    const pages = await buildOperationTemplatePages(
      fixture(2, 10, true, "desc"),
      Array.from({ length: 30 }, (_, i) => row(i + 1)),
      context,
    );
    expect(pages).toHaveLength(2);
    expect(slots(pages[0])[0].querySelectorAll("td")[1].textContent).toBe("1030");
    const last = slots(pages[1]);
    expect(last).toHaveLength(20);
    expect(last[0].querySelectorAll("td")[0].textContent).toBe("1");
    expect(last[9].querySelectorAll("td")[1].textContent).toBe("1001");
    expect(last[10].querySelector("table")).not.toBeNull();
    expect(last[10].textContent).toBe("");
  });

  it("고사실별 양식은 각 고사실 내에서 페이지를 나누고 사진을 각 수험생에 연결한다", async () => {
    photos.mockImplementation(async (id: string) => new Blob([id], { type: "image/png" }));
    const rows = Array.from({ length: 30 }, (_, i) => row(i + 1));
    rows[29].candidate.roomName = "102호";
    const pages = await buildOperationTemplatePages({ ...fixture(), usageScope: "ROOM" }, rows, context);
    expect(pages.map((html) => slots(html).filter((slot) => slot.style.visibility !== "hidden").length)).toEqual([
      20, 9, 1,
    ]);
    expect(slots(pages[0])[0].querySelector("img")?.src).toBe("data:image/png;base64,MTAwMQ==");
    expect(slots(pages[2])[0].querySelector("img")?.src).toBe("data:image/png;base64,MTAzMA==");
  });
});
