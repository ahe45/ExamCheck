// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  fetchAdminFormTemplates: vi.fn(async () => []),
  fetchFormTemplateDataTags: vi.fn(async () => ({ tags: [] })),
  saveFormTemplate: vi.fn(),
  updateFormTemplateActive: vi.fn(),
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

import { FormTemplateManager, formTemplateEditorSessionStorageKey } from "./FormTemplateManager";

describe("FormTemplateManager lazy editor boundary", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
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

  it("새로고침으로 다시 마운트되어도 열려 있던 양식 편집 화면을 복원한다", async () => {
    const firstView = render(<FormTemplateManager token="token" />);
    expect(await screen.findByRole("heading", { name: "양식 관리" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "첫 양식 만들기" }));
    expect(await screen.findByText("지연 로드된 양식 편집기")).toBeVisible();
    expect(window.sessionStorage.getItem(formTemplateEditorSessionStorageKey)).toBeTruthy();

    firstView.unmount();
    render(<FormTemplateManager token="token" />);

    expect(await screen.findByText("지연 로드된 양식 편집기")).toBeVisible();
  });

  it("양식 관리 메뉴를 다시 열면 복원 상태를 지우고 목록을 표시한다", async () => {
    const view = render(<FormTemplateManager token="token" resetKey={0} />);
    expect(await screen.findByRole("heading", { name: "양식 관리" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "첫 양식 만들기" }));
    expect(await screen.findByText("지연 로드된 양식 편집기")).toBeVisible();

    view.rerender(<FormTemplateManager token="token" resetKey={1} />);

    expect(await screen.findByRole("heading", { name: "양식 관리" })).toBeVisible();
    expect(window.sessionStorage.getItem(formTemplateEditorSessionStorageKey)).toBeNull();
  });
});
