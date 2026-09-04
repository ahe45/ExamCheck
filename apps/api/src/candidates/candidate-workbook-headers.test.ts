import { describe, expect, it } from "vitest";
import { candidateFields } from "./candidate-fields.js";
import { validateCandidateWorkbookHeaders } from "./candidates.service.js";

const expectedHeaders = candidateFields.map((field) => field.label);

describe("candidate workbook headers", () => {
  it("현재 업로드 양식의 전체 컬럼과 순서가 일치하면 허용한다", () => {
    expect(() => validateCandidateWorkbookHeaders(expectedHeaders)).not.toThrow();
  });

  it("일부 필수 컬럼이 있어도 전체 구성이 다르면 거부한다", () => {
    const differentHeaders = [...expectedHeaders];
    differentHeaders[10] = "연락처";

    expect(() => validateCandidateWorkbookHeaders(differentHeaders)).toThrow(
      "11번째 컬럼: '수험번호' 필요, 현재 '연락처'",
    );
  });

  it("과거 양식처럼 컬럼이 추가되거나 빠진 경우 거부한다", () => {
    const legacyHeaders = expectedHeaders.filter((header) => header !== "대기실명");

    expect(() => validateCandidateWorkbookHeaders(legacyHeaders)).toThrow(
      "필요한 컬럼은 18개이지만 17개가 확인되었습니다",
    );
  });
});
