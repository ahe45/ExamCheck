// @vitest-environment jsdom

import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindDataTagFormatControls } from "./data-tag-format-controls";

describe("data tag format controls", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("opens a date format modal and applies a preset to the selected tag", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-template-editor-runtime-surface>
        <span class="template-token" data-template-tag-value="@{candidate.examDate}"
          data-template-tag-label="시험날짜" data-template-tag-format-supported="true">시험날짜</span>
      </div>`;
    document.body.append(root);
    const onDirty = vi.fn();
    const dispose = bindDataTagFormatControls({ rootElement: root, onDirty });
    const token = root.querySelector<HTMLElement>(".template-token")!;

    fireEvent.click(token);
    expect(document.querySelector("[role='dialog']")).toBeTruthy();
    expect(document.querySelector("#examcheckDataTagFormatTitle")).toHaveTextContent("시험날짜");

    const preset = document.querySelector<HTMLSelectElement>("[data-data-tag-format-preset]")!;
    fireEvent.change(preset, { target: { value: "YYYY.MM.DD" } });
    expect(document.querySelector("[data-data-tag-format-preview]")).toHaveTextContent("2026.03.28");
    fireEvent.click(document.querySelector<HTMLButtonElement>("[data-data-tag-format-apply]")!);

    expect(token.dataset.templateTagFormatType).toBe("date");
    expect(token.dataset.templateTagFormat).toBe("YYYY.MM.DD");
    expect(onDirty).toHaveBeenCalledOnce();
    expect(document.querySelector("[role='dialog']")).toBeNull();
    dispose();
  });

  it("applies time formatting inside the data block editor and supports resetting to default", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-candidate-block-modal-editor-surface>
        <span class="template-token" data-template-tag-value="candidate.examStartTime"
          data-template-tag-label="시작시간" data-template-tag-format-supported="true"
          data-template-tag-format-type="time" data-template-tag-format="HH:mm">시작시간</span>
      </div>`;
    document.body.append(root);
    const onDirty = vi.fn();
    const inputEvent = vi.fn();
    const token = root.querySelector<HTMLElement>(".template-token")!;
    token.addEventListener("input", inputEvent);
    const dispose = bindDataTagFormatControls({ rootElement: root, onDirty });

    fireEvent.click(token);
    fireEvent.change(document.querySelector<HTMLSelectElement>("[data-data-tag-format-preset]")!, {
      target: { value: "" },
    });
    fireEvent.click(document.querySelector<HTMLButtonElement>("[data-data-tag-format-apply]")!);

    expect(token).not.toHaveAttribute("data-template-tag-format-type");
    expect(token).not.toHaveAttribute("data-template-tag-format");
    expect(inputEvent).toHaveBeenCalledOnce();
    expect(onDirty).toHaveBeenCalledOnce();
    dispose();
  });

  it("does not open formatting for unsupported text tags", () => {
    const root = document.createElement("div");
    root.innerHTML = '<span class="template-token" data-template-tag-value="candidate.name">이름</span>';
    document.body.append(root);
    const dispose = bindDataTagFormatControls({ rootElement: root, onDirty: vi.fn() });

    fireEvent.click(root.querySelector(".template-token")!);
    expect(document.querySelector("[role='dialog']")).toBeNull();
    dispose();
  });
});
