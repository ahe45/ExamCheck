// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormTemplate } from "../../shared/api/form-templates";
import { TemplateLibrary } from "./TemplateLibrary";

const apiMock = vi.hoisted(() => ({
  deleteFormTemplate: vi.fn(),
  saveFormTemplate: vi.fn(),
  updateFormTemplateActive: vi.fn(),
  updateFormTemplateMetadata: vi.fn(),
}));

vi.mock("../../shared/api/form-templates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/api/form-templates")>()),
  ...apiMock,
}));

const template: FormTemplate = {
  id: 7,
  code: "LABEL",
  name: "가번호표",
  description: "기본 설명",
  category: "가번호",
  usageScope: "CANDIDATE",
  layout: { layout: { pages: [] } },
  active: true,
  createdAt: "2026-08-28T00:00:00.000Z",
  createdByLoginId: "admin",
};

describe("TemplateLibrary", () => {
  beforeEach(() => {
    apiMock.saveFormTemplate.mockReset();
    apiMock.deleteFormTemplate.mockReset();
    apiMock.updateFormTemplateActive.mockReset();
    apiMock.updateFormTemplateMetadata.mockReset();
  });

  function renderLibrary(onTemplateUpdated = vi.fn(), onTemplateDeleted = vi.fn()) {
    render(
      <TemplateLibrary
        token="token"
        templates={[template]}
        refreshing={false}
        notice={null}
        onNoticeChange={vi.fn()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onRefresh={vi.fn(async () => undefined)}
        onTemplateDeleted={onTemplateDeleted}
        onTemplateUpdated={onTemplateUpdated}
      />,
    );
  }

  it("범위·분류 배지를 제거하고 사용 스위치와 삭제·복사 버튼을 표시한다", () => {
    renderLibrary();

    expect(screen.queryByText("v3 · 수험생별 · 사용 중")).not.toBeInTheDocument();
    expect(screen.queryByText("가번호")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "가번호표 사용 여부" })).toBeChecked();
    expect(screen.getByRole("button", { name: "삭제" })).toBeVisible();
    expect(screen.getByRole("button", { name: "복사" })).toBeVisible();
    expect(
      Array.from(document.querySelectorAll(".template-card-actions button")).map((button) =>
        button.textContent?.trim(),
      ),
    ).toEqual(["삭제", "복사", "수정"]);
  });

  it("스위치 변경을 저장하고 복사본은 미사용 상태로 생성한다", async () => {
    const onTemplateUpdated = vi.fn();
    apiMock.updateFormTemplateActive.mockResolvedValue({ ...template, id: 8, active: false });
    apiMock.saveFormTemplate.mockResolvedValue({
      ...template,
      id: 9,
      code: "LABEL_COPY",
      name: "가번호표 복사본",
      active: false,
    });
    renderLibrary(onTemplateUpdated);

    fireEvent.click(screen.getByRole("switch", { name: "가번호표 사용 여부" }));
    await waitFor(() => expect(apiMock.updateFormTemplateActive).toHaveBeenCalledWith("token", "LABEL", false));

    const copyButton = screen.getByRole("button", { name: "복사" });
    await waitFor(() => expect(copyButton).toBeEnabled());
    fireEvent.click(copyButton);
    await waitFor(() => expect(apiMock.saveFormTemplate).toHaveBeenCalledTimes(1));
    expect(apiMock.saveFormTemplate.mock.calls[0]?.[1]).toMatchObject({
      code: "LABEL_COPY",
      name: "가번호표 복사본",
      active: false,
    });
    expect(onTemplateUpdated).toHaveBeenCalledTimes(2);
  });

  it("확인 모달을 거쳐 양식을 삭제하고 카드 목록 갱신을 요청한다", async () => {
    const onTemplateDeleted = vi.fn();
    apiMock.deleteFormTemplate.mockResolvedValue(undefined);
    renderLibrary(vi.fn(), onTemplateDeleted);

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(screen.getByRole("dialog", { name: "양식을 삭제하시겠습니까?" })).toBeVisible();
    expect(screen.getByText("가번호표", { selector: ".template-delete-modal strong" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "양식 삭제" }));
    await waitFor(() => expect(apiMock.deleteFormTemplate).toHaveBeenCalledWith("token", "LABEL"));
    expect(onTemplateDeleted).toHaveBeenCalledWith("LABEL");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
