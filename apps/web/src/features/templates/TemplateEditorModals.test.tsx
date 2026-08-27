// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TemplateInformationModal } from "./TemplateEditorModals";
import { createBlankDraft } from "./template-manager-model";

describe("TemplateInformationModal", () => {
  it("stack-aware ESC 처리로 모달을 닫는다", () => {
    const onClose = vi.fn();
    render(<TemplateInformationModal draft={createBlankDraft(100)} onChange={vi.fn()} onClose={onClose} />);

    expect(screen.getByRole("dialog", { name: "양식 정보" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "닫기" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
