import { describe, expect, it } from "vitest";
import {
  getRequiredTemplateSignatureFields,
  getTemplateSignatureNameInputEnabled,
  getUsedTemplateSignatureFields,
  writeTemplateSignatureNameInputEnabled,
} from "./template-signatures";

describe("template signatures", () => {
  it("detects only signature tags actually used by the template", () => {
    const template = {
      layout: {
        pages: [
          {
            settings: {
              documentHtml: '<span data-template-tag-value="signature.author"></span>',
              signatureNames: { enabled: true },
            },
          },
        ],
      },
    };

    expect(getTemplateSignatureNameInputEnabled(template)).toBe(true);
    expect(getUsedTemplateSignatureFields(template).map((field) => field.key)).toEqual(["signature.author"]);
    expect(getRequiredTemplateSignatureFields(template).map((field) => field.label)).toEqual(["작성자"]);
  });

  it("keeps signer inputs optional when the page switch is off", () => {
    const page = { settings: { documentHtml: '<span data-template-tag-value="@{signature.reviewer}"></span>' } };
    writeTemplateSignatureNameInputEnabled(page, false);
    const template = { layout: { pages: [page] } };

    expect(getUsedTemplateSignatureFields(template).map((field) => field.key)).toEqual(["signature.reviewer"]);
    expect(getRequiredTemplateSignatureFields(template)).toEqual([]);
  });
});
