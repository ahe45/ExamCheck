import { describe, expect, it } from "vitest";
import {
  formTemplateSecurityRuleCodes,
  scanFormTemplateSecurityRisks,
  summarizeFormTemplateSecurityRisks,
} from "./form-template-security.js";

const seededPseudonymSlipLayout: Record<string, unknown> = {
  id: "template-pseudonym-slip",
  name: "가번호표",
  layout: {
    dataTagSettings: {
      sampleData: {
        "candidate.examNo": "20260001",
        "candidate.name": "홍길동",
        "candidate.temporaryNo": "1501",
        "candidate.examDate": "2026-09-12",
        "candidate.roomName": "A-101",
      },
    },
    pages: [
      {
        id: "page-1",
        type: "content",
        settings: {
          documentHtml:
            '<div style="text-align:center;padding:32px 20px;"><p style="font-size:15px;letter-spacing:.16em;">가번호 관리 시스템</p><h1 style="font-size:32px;margin:24px 0 8px;">가번호표</h1><p style="font-size:76px;font-weight:700;margin:18px 0;"><span class="template-token" data-template-tag-value="candidate.temporaryNo">1501</span></p><table style="width:100%;border-collapse:collapse;margin-top:28px;"><tbody><tr><th style="border:1px solid #333;padding:10px;">수험번호</th><td style="border:1px solid #333;padding:10px;"><span class="template-token" data-template-tag-value="candidate.examNo">20260001</span></td></tr><tr><th style="border:1px solid #333;padding:10px;">성명</th><td style="border:1px solid #333;padding:10px;"><span class="template-token" data-template-tag-value="candidate.name">홍길동</span></td></tr><tr><th style="border:1px solid #333;padding:10px;">시험실</th><td style="border:1px solid #333;padding:10px;"><span class="template-token" data-template-tag-value="candidate.roomName">A-101</span></td></tr></tbody></table></div>',
        },
      },
    ],
  },
};

describe("form-template security risk scanner", () => {
  it("does not report false positives for the seeded production form fixture", () => {
    expect(scanFormTemplateSecurityRisks(seededPseudonymSlipLayout)).toEqual([]);
  });

  it("recursively detects every blocked rule and returns no matched content", () => {
    const privateMarker = "홍길동-PRIVATE-MARKER";
    const maliciousLayout = {
      layout: {
        pages: [
          {
            settings: {
              documentHtml: [
                `<script>/* ${privateMarker} */</script>`,
                '<iframe src="about:blank"></iframe>',
                '<object data="about:blank"></object>',
                '<embed src="about:blank">',
                '<meta content="0; url=/next" http-equiv="refresh">',
                '<img src="x" onerror="alert(1)">',
                '<a href="javascript:alert(1)">link</a>',
                '<a href="vbscript:msgbox(1)">link</a>',
                '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>',
                '<div style="width: expression(alert(1)); background-image: url(javascript:alert(1))"></div>',
              ].join(""),
            },
          },
        ],
      },
    };

    const risks = scanFormTemplateSecurityRisks(maliciousLayout);
    const detectedRuleCodes = new Set(risks.map((risk) => risk.ruleCode));

    expect(detectedRuleCodes).toEqual(new Set(formTemplateSecurityRuleCodes));
    expect(risks.every((risk) => risk.path === "$.layout.pages[0].settings.documentHtml")).toBe(true);
    expect(risks.every((risk) => Object.keys(risk).sort().join(",") === "path,ruleCode")).toBe(true);
    expect(JSON.stringify(risks)).not.toContain(privateMarker);
    expect(JSON.stringify(risks)).not.toContain("alert(1)");

    const summary = summarizeFormTemplateSecurityRisks(risks);
    expect(summary.riskCount).toBe(risks.length);
    for (const ruleCode of formTemplateSecurityRuleCodes) {
      expect(summary.ruleCounts[ruleCode]).toBeGreaterThan(0);
    }
  });
});
