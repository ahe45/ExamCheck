// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { bindAbsenceHighlightControls } from "./absence-highlight-controls";
import type { TemplateEditorPage } from "../../shared/templates/template-editor-contracts";

it("requires the absence tag inside a table, saves color to the current page and disables after removal", async () => {
  const panel = document.createElement("aside");
  panel.innerHTML = '<section class="examcheck-signature-name-field"></section>';
  const surface = document.createElement("div");
  surface.innerHTML = '<p><span data-template-tag-value="candidate.absent">결시 여부</span></p>';
  const page: TemplateEditorPage = { id: "page", settings: {} };
  let current = structuredClone(page);
  const dirty = vi.fn();
  const dispose = bindAbsenceHighlightControls({
    pagePropertiesHost: panel,
    selectedPage: page,
    getCurrentPage: () => current,
    surfaceElement: surface,
    onDirty: dirty,
  });
  const input = panel.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  const gear = panel.querySelector<HTMLButtonElement>(".examcheck-absence-color-trigger")!;
  expect(input).toBeDisabled();
  expect(gear).toBeDisabled();
  surface.innerHTML =
    '<table><tr><td>이름</td><td><span data-template-tag-value="candidate.absent">결시 여부</span></td></tr></table>';
  await waitFor(() => expect(input).not.toBeDisabled());
  input.checked = true;
  fireEvent.change(input);
  expect(current.settings?.absenceHighlight).toEqual({ enabled: true, color: "#e2e8f0" });
  expect(surface.querySelector("tr")).toHaveAttribute("data-examcheck-absence-preview", "true");
  current = structuredClone(current);
  fireEvent.click(gear);
  expect(gear).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(panel.querySelector('[data-absence-color="#fee2e2"]')!);
  expect(current.settings?.absenceHighlight).toEqual({ enabled: true, color: "#fee2e2" });
  expect(panel.querySelector("style")?.textContent).toContain("#fee2e2");
  surface.querySelector("span")?.remove();
  await waitFor(() => expect(input).toBeDisabled());
  expect(input.checked).toBe(false);
  expect(current.settings?.absenceHighlight).toEqual({ enabled: false, color: "#fee2e2" });
  expect(surface.querySelector("[data-examcheck-absence-preview]")).toBeNull();
  expect(gear).toHaveAttribute("aria-expanded", "false");
  expect(panel.firstElementChild).toHaveClass("examcheck-absence-highlight-field");
  expect(dirty).toHaveBeenCalledTimes(3);
  dispose();
});
