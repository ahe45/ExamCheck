// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderTemplateHtml, sanitizeTemplateHtml } from "./template-renderer";

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
});
