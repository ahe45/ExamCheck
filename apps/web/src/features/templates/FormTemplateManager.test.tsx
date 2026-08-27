// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  fetchAdminFormTemplates: vi.fn(async () => []),
  fetchFormTemplateDataTags: vi.fn(async () => ({ tags: [] })),
  updateFormTemplateMetadata: vi.fn(),
}));

const lazyEntryMock = vi.hoisted(() => ({ loaded: vi.fn() }));

vi.mock("../../shared/api/form-templates", () => apiMock);

vi.mock("./TemplateEditorWorkspaceLazy", async () => {
  lazyEntryMock.loaded();
  const React = await import("react");
  return {
    default: React.forwardRef(() => React.createElement("div", null, "지연 로드된 양식 편집기")),
  };
});

import { FormTemplateManager } from "./FormTemplateManager";

describe("FormTemplateManager lazy editor boundary", () => {
  beforeEach(() => {
    apiMock.fetchAdminFormTemplates.mockClear();
    apiMock.fetchFormTemplateDataTags.mockClear();
    lazyEntryMock.loaded.mockClear();
  });

  it("양식 목록에서는 편집기를 불러오지 않고 편집 진입 시에만 불러온다", async () => {
    render(<FormTemplateManager token="token" />);

    expect(await screen.findByRole("heading", { name: "양식 관리" })).toBeVisible();
    expect(lazyEntryMock.loaded).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "첫 양식 만들기" }));

    expect(await screen.findByText("지연 로드된 양식 편집기")).toBeVisible();
    expect(lazyEntryMock.loaded).toHaveBeenCalledTimes(1);
  });
});
