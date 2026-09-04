// @vitest-environment jsdom

import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { bindSignatureNameControls } from "./signature-name-controls";

describe("signature name controls", () => {
  it("enables the switch only while a signature tag exists on the canvas", async () => {
    const panel = document.createElement("aside");
    panel.innerHTML = '<section class="examlist-page-number-field"></section>';
    const surface = document.createElement("div");
    const page: { settings: { documentHtml: string; signatureNames?: { enabled: boolean } } } = {
      settings: { documentHtml: "<p></p>" },
    };
    const onDirty = vi.fn();
    const dispose = bindSignatureNameControls({
      pagePropertiesHost: panel,
      selectedPage: page,
      surfaceElement: surface,
      onDirty,
    });
    const input = panel.querySelector<HTMLInputElement>("[data-examcheck-signature-name-setting]")!;

    expect(input).toBeDisabled();
    const authorTag = document.createElement("span");
    authorTag.dataset.templateTagValue = "@{signature.author}";
    surface.append(authorTag);
    await waitFor(() => expect(input).toBeEnabled());

    input.checked = true;
    fireEvent.change(input);

    expect(page.settings.signatureNames).toEqual({ enabled: true });
    expect(onDirty).toHaveBeenCalledOnce();
    expect(panel.querySelector(".examcheck-signature-name-field")?.nextElementSibling).toHaveClass(
      "examlist-page-number-field",
    );
    expect(panel.querySelector(".examcheck-signature-name-summary")).toBeNull();
    expect(panel.querySelector(".examcheck-signature-name-header")).toHaveClass("examlist-page-number-header");
    authorTag.remove();
    await waitFor(() => expect(input).toBeDisabled());
    expect(input).not.toBeChecked();
    expect(page.settings.signatureNames).toEqual({ enabled: false });
    expect(onDirty).toHaveBeenCalledTimes(2);
    dispose();
    expect(panel.querySelector(".examcheck-signature-name-field")).toBeNull();
  });
});
