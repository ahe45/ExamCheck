export const formTemplateSecurityRuleCodes = [
  "HTML_SCRIPT_ELEMENT",
  "HTML_IFRAME_ELEMENT",
  "HTML_OBJECT_ELEMENT",
  "HTML_EMBED_ELEMENT",
  "HTML_META_REFRESH",
  "HTML_EVENT_HANDLER_ATTRIBUTE",
  "URL_JAVASCRIPT_SCHEME",
  "URL_VBSCRIPT_SCHEME",
  "URL_DATA_HTML",
  "CSS_EXPRESSION",
  "CSS_JAVASCRIPT_URL",
] as const;

export type FormTemplateSecurityRuleCode = (typeof formTemplateSecurityRuleCodes)[number];

export interface FormTemplateSecurityRisk {
  path: string;
  ruleCode: FormTemplateSecurityRuleCode;
}

export interface FormTemplateSecurityRiskSummary {
  riskCount: number;
  ruleCounts: Record<FormTemplateSecurityRuleCode, number>;
}

interface PatternRule {
  ruleCode: FormTemplateSecurityRuleCode;
  pattern: RegExp;
}

const stringPatternRules: readonly PatternRule[] = [
  { ruleCode: "HTML_SCRIPT_ELEMENT", pattern: /<\s*script(?:\s|>)/giu },
  { ruleCode: "HTML_IFRAME_ELEMENT", pattern: /<\s*iframe(?:\s|>)/giu },
  { ruleCode: "HTML_OBJECT_ELEMENT", pattern: /<\s*object(?:\s|>)/giu },
  { ruleCode: "HTML_EMBED_ELEMENT", pattern: /<\s*embed(?:\s|\/?>)/giu },
  { ruleCode: "URL_JAVASCRIPT_SCHEME", pattern: /\bjavascript\s*:/giu },
  { ruleCode: "URL_VBSCRIPT_SCHEME", pattern: /\bvbscript\s*:/giu },
  { ruleCode: "URL_DATA_HTML", pattern: /\bdata\s*:\s*text\s*\/\s*html\b/giu },
  { ruleCode: "CSS_EXPRESSION", pattern: /\bexpression\s*\(/giu },
  {
    ruleCode: "CSS_JAVASCRIPT_URL",
    pattern: /\burl\s*\(\s*(?:["']\s*)?javascript\s*:/giu,
  },
];

const htmlTagPattern = /<\s*[a-z][^>]*>/giu;
const eventHandlerAttributePattern = /\son[a-z][a-z0-9_.:-]*\s*=/giu;
const metaElementPattern = /^<\s*meta(?:\s|\/?>)/iu;
const metaRefreshAttributePattern = /\bhttp-equiv\s*=\s*(?:"\s*refresh\s*"|'\s*refresh\s*'|refresh(?=\s|\/?>))/iu;

/**
 * Recursively inspects a form-template layout without modifying it. Findings contain
 * only a structural JSON path and a rule code; matched content is deliberately omitted.
 */
export function scanFormTemplateSecurityRisks(layout: Record<string, unknown>): FormTemplateSecurityRisk[] {
  const risks: FormTemplateSecurityRisk[] = [];
  scanValue(layout, "$", risks);
  return risks;
}

export function summarizeFormTemplateSecurityRisks(
  risks: readonly FormTemplateSecurityRisk[],
): FormTemplateSecurityRiskSummary {
  const ruleCounts = Object.fromEntries(formTemplateSecurityRuleCodes.map((ruleCode) => [ruleCode, 0])) as Record<
    FormTemplateSecurityRuleCode,
    number
  >;

  for (const risk of risks) ruleCounts[risk.ruleCode] += 1;
  return { riskCount: risks.length, ruleCounts };
}

function scanValue(value: unknown, path: string, risks: FormTemplateSecurityRisk[]) {
  if (typeof value === "string") {
    scanString(value, path, risks);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanValue(item, `${path}[${index}]`, risks));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    scanValue(child, appendPath(path, key), risks);
  }
}

function scanString(value: string, path: string, risks: FormTemplateSecurityRisk[]) {
  for (const rule of stringPatternRules) {
    addMatches(value, path, rule, risks);
  }

  for (const tag of value.matchAll(htmlTagPattern)) {
    const tagText = tag[0];
    addMatches(
      tagText,
      path,
      { ruleCode: "HTML_EVENT_HANDLER_ATTRIBUTE", pattern: eventHandlerAttributePattern },
      risks,
    );
    if (metaElementPattern.test(tagText) && metaRefreshAttributePattern.test(tagText)) {
      risks.push({ path, ruleCode: "HTML_META_REFRESH" });
    }
  }
}

function addMatches(value: string, path: string, rule: PatternRule, risks: FormTemplateSecurityRisk[]) {
  const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
  for (const _match of value.matchAll(pattern)) {
    risks.push({ path, ruleCode: rule.ruleCode });
  }
}

function appendPath(path: string, key: string) {
  if (/^[A-Za-z_$][A-Za-z0-9_$-]*$/u.test(key)) return `${path}.${key}`;
  return `${path}[${JSON.stringify(key)}]`;
}
