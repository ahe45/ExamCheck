import { describe, expect, it } from "vitest";
import type { FormTemplate } from "../../shared/api/form-templates";
import {
  buildCardMetadataUpdate,
  createBlankDraft,
  createCardMetadataEdit,
  createDraftMetadataSnapshot,
  isDraftMetadataDirty,
  updateDraftMetadata,
} from "./template-manager-model";

const template: FormTemplate = {
  id: 7,
  code: "LABEL",
  version: 3,
  name: "가번호 라벨",
  description: "기본 설명",
  category: "라벨",
  usageScope: "CANDIDATE",
  layout: { layout: { pages: [] } },
  active: true,
  createdAt: "2026-08-28T00:00:00.000Z",
  createdByLoginId: "admin",
};

describe("template manager model", () => {
  it("제목과 설명 카드 편집값을 정리해 API 입력으로 만든다", () => {
    const nameEdit = { ...createCardMetadataEdit(template, "name"), value: "  새 제목  " };
    expect(buildCardMetadataUpdate(template, nameEdit)).toEqual({
      name: "새 제목",
      description: "기본 설명",
    });

    const descriptionEdit = {
      ...createCardMetadataEdit(template, "description"),
      value: "  새 설명  ",
    };
    expect(buildCardMetadataUpdate(template, descriptionEdit)).toEqual({
      name: "가번호 라벨",
      description: "새 설명",
    });
  });

  it("공백 제목과 다른 양식의 편집 상태를 거부한다", () => {
    expect(() =>
      buildCardMetadataUpdate(template, {
        templateId: template.id,
        field: "name",
        value: "   ",
      }),
    ).toThrow("양식 제목을 입력해 주세요.");
    expect(() =>
      buildCardMetadataUpdate(template, {
        templateId: 99,
        field: "description",
        value: "설명",
      }),
    ).toThrow("수정 중인 양식 정보가 일치하지 않습니다.");
  });

  it("메타데이터 스냅샷은 변경과 원복을 정확히 구분하고 레이아웃은 제외한다", () => {
    const draft = createBlankDraft(100);
    const snapshot = createDraftMetadataSnapshot(draft);
    expect(isDraftMetadataDirty(draft, snapshot)).toBe(false);

    const edited = updateDraftMetadata(draft, "description", "설명 변경");
    expect(isDraftMetadataDirty(edited, snapshot)).toBe(true);
    expect(isDraftMetadataDirty(updateDraftMetadata(edited, "description", ""), snapshot)).toBe(false);

    const layoutOnly = {
      ...draft,
      layout: { ...draft.layout, name: "편집기 내부 변경" },
    };
    expect(isDraftMetadataDirty(layoutOnly, snapshot)).toBe(false);
  });
});
