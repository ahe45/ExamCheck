// @vitest-environment jsdom

import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { bindSignatureNameControls } from "./signature-name-controls";

describe("signature name controls", () => {
  it("writes toggles and tag removal to the current page after editor synchronization replaces it", async () => {
    const panel = document.createElement("aside");
    const surface = document.createElement("div");
    surface.innerHTML = '<span data-template-tag-value="signature.author">작성자</span>';
    const initialPage = { id: "page", settings: { signatureNames: { enabled: false } } };
    let currentPage = structuredClone(initialPage);
    const saved: boolean[] = [];
    const dispose = bindSignatureNameControls({
      pagePropertiesHost: panel,
      selectedPage: initialPage,
      getCurrentPage: () => currentPage,
      surfaceElement: surface,
      onDirty: () => saved.push(currentPage.settings.signatureNames.enabled),
    });
    const input = panel.querySelector<HTMLInputElement>("input")!;
    for (const enabled of [true, false, true]) {
      currentPage = structuredClone(currentPage);
      input.checked = enabled;
      fireEvent.change(input);
      expect(currentPage.settings.signatureNames.enabled).toBe(enabled);
    }
    currentPage = structuredClone(currentPage);
    surface.replaceChildren();
    await waitFor(() => expect(input).toBeDisabled());
    expect(currentPage.settings.signatureNames.enabled).toBe(false);
    expect(saved).toEqual([true, false, true, false]);
    expect(initialPage.settings.signatureNames.enabled).toBe(false);
    dispose();
  });

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
