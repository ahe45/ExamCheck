// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { FormTemplate } from "../../shared/api/form-templates";
import type { OperationRow } from "./operation-view-model";
import { buildOperationTemplatePages, type OperationTemplateContext } from "./operation-template-pages";

const photos = vi.hoisted(() => vi.fn(async () => null));
vi.mock("../../shared/api/examinees", async (original) => ({
  ...(await original<typeof import("../../shared/api/examinees")>()),
  fetchExamineePhoto: photos,
}));

const context = {
  token: "test",
  systemProfile: { schoolName: "학교", academicYear: 2026, systemName: "시험" },
  schedule: {
    date: "2026-10-30",
    time: "10:00",
    periodName: "오전",
    admissionName: "면접",
    labelPrintingEnabled: false,
  },
  examName: "면접",
  operationClosed: true,
} as OperationTemplateContext;

function rows(): OperationRow[] {
  return [
    { name: "미등록만있는방", roomName: "100호", assigned: false },
    { name: "응시자1", roomName: "101호", assigned: true, lastPrintedAt: "2026-10-30T01:00:00Z" },
    { name: "명시적결시", roomName: "101호", assigned: true, absent: true, lastPrintedAt: "2026-10-30T01:00:00Z" },
    { name: "미등록", roomName: "101호", assigned: false },
    { name: "응시자2", roomName: "102호", assigned: true },
  ].map(
    (candidate, i) =>
      ({
        candidate: { ...candidate, examineeNo: String(i + 1), buildingName: "본관" },
        assignment: candidate.assigned ? { pseudonymNumber: String(i + 1) } : null,
      }) as unknown as OperationRow,
  );
}

function template(scope: FormTemplate["usageScope"], grid = false): FormTemplate {
  const content =
    "<p>{{candidate.name}}/{{candidate.absent}}/{{room.assignedCount}}/{{room.presentCount}}/{{room.absentCount}}</p>";
  const html = grid
    ? `<div data-candidate-block-grid="true" data-candidate-block-columns="1" data-candidate-block-rows="2"><div data-candidate-block-instance="1">${content}</div><div data-candidate-block-instance="2">${content}</div></div>`
    : content;
  return { usageScope: scope, layout: { documentHtml: html } } as FormTemplate;
}

describe("document print target", () => {
  it.each(["CANDIDATE", "ROOM", "EXAM"] as const)(
    "filters %s documents before grouping while preserving attendance totals",
    async (scope) => {
      const source = rows();
      const pages = await buildOperationTemplatePages(template(scope), source, { ...context, printTarget: "PRESENT" });
      expect(pages).toHaveLength(scope === "EXAM" ? 1 : 2);
      expect(pages.join("")).toContain("응시자1/응시");
      expect(pages.join("")).not.toMatch(/미등록|명시적결시/);
      if (scope === "ROOM") expect(pages[0]).toContain("응시자1/응시/3/1/2");
      const all = await buildOperationTemplatePages(template(scope), source, { ...context, printTarget: "ALL" });
      expect(all).toHaveLength(scope === "CANDIDATE" ? 5 : scope === "ROOM" ? 3 : 1);
      expect(all[0]).toContain("미등록만있는방/결시");
      expect(source).toHaveLength(5);
    },
  );
  it.each(["CANDIDATE", "ROOM", "EXAM"] as const)(
    "filters %s data blocks and excludes unprinted preassigned candidates",
    async (scope) => {
      const pages = await buildOperationTemplatePages(template(scope, true), rows(), {
        ...context,
        printTarget: "PRESENT",
        labelPrintingEnabled: true,
      });
      expect(pages).toHaveLength(1);
      expect(pages[0]).toContain("응시자1/응시");
      expect(pages[0]).not.toMatch(/응시자2|미등록|명시적결시/);
      const all = await buildOperationTemplatePages(template(scope, true), rows(), {
        ...context,
        printTarget: "ALL",
        labelPrintingEnabled: true,
      });
      expect(all.join("")).toContain("응시자2/결시");
    },
  );
  it("stops before fetching photos when no candidates are present", async () => {
    const photoTemplate = {
      ...template("CANDIDATE"),
      layout: { documentHtml: '<img data-template-tag-value="candidate.photo">' },
    };
    await expect(
      buildOperationTemplatePages(photoTemplate, rows().slice(0, 1), { ...context, printTarget: "PRESENT" }),
    ).rejects.toThrow("응시한 수험생이 없어 출력할 수 없습니다.");
    expect(photos).not.toHaveBeenCalled();
  });
});
