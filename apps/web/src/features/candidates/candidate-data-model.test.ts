import { describe, expect, it } from "vitest";
import type { CandidateRecord } from "../../shared/api/candidates";
import { ApiError } from "../../shared/api/client";
import {
  candidateColumns,
  candidateColumnValue,
  candidateUploadPolicies,
  photoPolicyDescription,
  workbookPreviewErrorMessage,
} from "./candidate-data-model";

describe("candidate data model", () => {
  it("업로드 양식과 동일한 데이터 컬럼 및 OPT1~3 구성을 제공한다", () => {
    expect(candidateColumns.map(({ key }) => key)).toEqual([
      "designatedSort",
      "date",
      "time",
      "period",
      "admission",
      "unit",
      "major",
      "building",
      "room",
      "examineeNo",
      "temporaryNo",
      "name",
      "birth",
      "group",
      "opt1",
      "opt2",
      "opt3",
    ]);
    expect(candidateUploadPolicies.map(({ value }) => value)).toEqual(["insert-only", "insert-update", "all"]);
  });

  it("그리드 비교값은 빈 데이터를 빈 문자열로 정규화한다", () => {
    const row = { examineeNo: "1162001", temporaryNo: "" } as CandidateRecord;
    expect(candidateColumnValue(row, "examineeNo")).toBe("1162001");
    expect(candidateColumnValue(row, "temporaryNo")).toBe("");
  });

  it("잘못된 워크북 상세 오류를 사용자 안내문과 함께 표시한다", () => {
    expect(workbookPreviewErrorMessage(new ApiError("필수 열 누락", 400, "VALIDATION_ERROR"))).toBe(
      "선택한 파일이 수험생 업로드 양식과 일치하지 않습니다. 업로드 양식을 확인해 주세요. (필수 열 누락)",
    );
    expect(workbookPreviewErrorMessage(null)).toBe("업로드 파일 미리보기를 생성하지 못했습니다.");
  });

  it("응답 계약 오류는 업로드 양식 오류로 오인하지 않는다", () => {
    expect(
      workbookPreviewErrorMessage(
        new ApiError("서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.", 502, "INVALID_RESPONSE"),
      ),
    ).toBe("서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    expect(workbookPreviewErrorMessage(new ApiError("서버 점검 중입니다.", 503, "INTERNAL_ERROR"))).toBe(
      "서버 점검 중입니다.",
    );
  });

  it("사진 반영 정책별 설명을 구분한다", () => {
    expect(photoPolicyDescription("insert-only")).toContain("등록된 수험생은 건너뜁니다");
    expect(photoPolicyDescription("insert-update")).toContain("변경된 사진만 반영합니다");
    expect(photoPolicyDescription("all")).toContain("전체를 다시 반영합니다");
  });
});
