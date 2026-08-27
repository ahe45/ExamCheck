import type { CandidateFieldKey, CandidateRecord, CandidateUploadPolicy } from "../../shared/api/candidates";
import { ApiError } from "../../shared/api/client";

export interface CandidateColumn {
  key: CandidateFieldKey;
  label: string;
}

export const candidateColumns: CandidateColumn[] = [
  ["designatedSort", "지정정렬"],
  ["date", "시험날짜"],
  ["time", "시험시간"],
  ["period", "교시명"],
  ["admission", "전형명"],
  ["unit", "모집단위명"],
  ["major", "전공명"],
  ["building", "고사건물명"],
  ["room", "고사실명"],
  ["examineeNo", "수험번호"],
  ["temporaryNo", "가번호"],
  ["name", "이름"],
  ["birth", "생년월일"],
  ["group", "조"],
  ...Array.from({ length: 3 }, (_, index) => [`opt${index + 1}` as CandidateFieldKey, `OPT${index + 1}`]),
].map(([key, label]) => ({ key: key as CandidateFieldKey, label }));

export const candidateWideColumnKeys = new Set<CandidateFieldKey>(["admission", "unit", "major"]);

export const candidateUploadPolicies: Array<{
  value: CandidateUploadPolicy;
  label: string;
  description: string;
}> = [
  { value: "insert-only", label: "신규만 반영", description: "기존 데이터 수정건과 동일 데이터는 건너뜁니다." },
  {
    value: "insert-update",
    label: "신규 + 수정 반영",
    description: "동일 데이터는 건너뛰고 신규와 수정건만 반영합니다.",
  },
  { value: "all", label: "전체 반영", description: "동일 데이터까지 포함해 업로드 파일 전체를 다시 반영합니다." },
];

export function candidateColumnValue(row: CandidateRecord, key: CandidateFieldKey) {
  return String(row[key] || "");
}

export function messageOf(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

export function workbookPreviewErrorMessage(reason: unknown) {
  const guide = "선택한 파일이 수험생 업로드 양식과 일치하지 않습니다. 업로드 양식을 확인해 주세요.";
  if (reason instanceof ApiError) {
    if (reason.code === "INVALID_RESPONSE") return reason.message;
    if (reason.status === 400 && reason.code === "VALIDATION_ERROR") {
      return reason.message ? `${guide} (${reason.message})` : guide;
    }
    return reason.message;
  }
  return messageOf(reason, "업로드 파일 미리보기를 생성하지 못했습니다.");
}

export function photoPolicyDescription(policy: CandidateUploadPolicy) {
  if (policy === "insert-only") return "이미 사진이 등록된 수험생은 건너뜁니다.";
  if (policy === "insert-update") return "같은 사진은 건너뛰고 신규 사진과 변경된 사진만 반영합니다.";
  return "동일한 사진까지 포함해 ZIP 파일 전체를 다시 반영합니다.";
}
