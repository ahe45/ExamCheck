// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderTemplateHtml, sanitizeTemplateHtml } from "./template-renderer";
import { TemplateDataProjectionError } from "./template-data-projection";

describe("template renderer security boundary", () => {
  it("removes executable markup while preserving editor data tags and safe styles", () => {
    const html = sanitizeTemplateHtml(
      `<section class="sheet" data-template-tag-value="candidate.name" style="text-align:center">홍길동</section>
       <script>alert(1)</script><iframe srcdoc="<script>alert(2)</script>"></iframe>
       <img src="javascript:alert(3)" onerror="alert(4)">`,
    );

    expect(html).toContain('class="sheet"');
    expect(html).toContain('data-template-tag-value="candidate.name"');
    expect(html).toContain("text-align:center");
    expect(html).not.toMatch(/script|iframe|onerror|javascript:/i);
  });

  it("escapes placeholder values and keeps generated tag replacement as text", () => {
    const html = renderTemplateHtml(
      '<p>{{candidate.name}}</p><span data-template-tag-value="candidate.examNo"></span>',
      { "candidate.name": '<img src=x onerror="alert(1)">', "candidate.examNo": "10001" },
    );

    expect(html).toContain('&lt;img src=x onerror="alert(1)"&gt;');
    expect(html).toContain(">10001</span>");
    expect(html).not.toContain("<img src=x");
  });

  it("keeps legacy data tags working with target identity projection aliases", () => {
    const html = renderTemplateHtml(
      '<p>{{candidate.examNo}}</p><span data-template-tag-value="candidate.temporaryNo"></span>',
      {
        "candidate.examineeNo": "10001",
        "assignment.pseudonymNumber": "007",
      },
    );

    expect(html).toContain("<p>10001</p>");
    expect(html).toContain(">007</span>");
  });

  it("renders legacy wrapped editor tokens with the canonical data key", () => {
    const html = renderTemplateHtml(
      '<p>@{candidate.admissionYear}</p><span data-template-tag-value="@{candidate.admissionYear}"></span>',
      { "examCycle.academicYear": "2027" },
    );

    expect(html).toContain("<p>2027</p>");
    expect(html).toContain(">2027</span>");
  });

  it("fails explicitly instead of rendering a missing referenced value as blank", () => {
    expect(() => renderTemplateHtml('<span data-template-tag-value="candidate.examNo"></span>', {})).toThrow(
      TemplateDataProjectionError,
    );
    expect(() => renderTemplateHtml("<p>{{candidate.examNo}}</p>", {})).toThrow(
      "양식 데이터 태그 값을 찾을 수 없습니다: candidate.examNo",
    );
  });

  it("preserves intentional blank values and numeric zero", () => {
    const html = renderTemplateHtml(
      '<span data-template-tag-value="candidate.majorName"></span><b>{{room.absentCount}}</b>',
      { "candidate.majorName": "", "room.absentCount": 0 },
    );

    expect(html).toContain('<span data-template-tag-value="candidate.majorName"></span>');
    expect(html).toContain("<b>0</b>");
  });

  it("applies the selected date and time formats during preview rendering", () => {
    const html = renderTemplateHtml(
      `<span data-template-tag-value="candidate.examDate" data-template-tag-format-type="date" data-template-tag-format="YYYY.MM.DD (ddd)"></span>
       <span data-template-tag-value="candidate.examStartTime" data-template-tag-format-type="time" data-template-tag-format="A h:mm"></span>`,
      { "operationSlot.examDate": "2026-03-28", "operationSlot.startTime": "08:40" },
    );

    expect(html).toContain(">2026.03.28 (토)</span>");
    expect(html).toContain(">오전 8:40</span>");
  });

  it.each([
    ["barcode", "Code128 바코드"],
    ["qrcode", "QR코드"],
  ])("renders a generated %s object with the resolved system value", (objectType, altSuffix) => {
    const html = renderTemplateHtml(
      `<img class="template-generated-object template-generated-object-${objectType}" data-template-object-type="${objectType}" data-template-object-source="candidate.examNo">`,
      { "candidate.examineeNo": "240001" },
    );
    const document = new DOMParser().parseFromString(html, "text/html");
    const image = document.querySelector<HTMLImageElement>("img.template-generated-object");

    expect(image?.src).toMatch(/^data:image\/svg\+xml/);
    expect(decodeURIComponent(image?.src || "")).toContain("<svg");
    expect(image?.alt).toBe(`240001 ${altSuffix}`);
    expect(image?.hasAttribute("data-render-pending")).toBe(false);
  });
});
