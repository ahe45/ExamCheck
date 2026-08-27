interface CandidateFieldDefinitionShape {
  key: string;
  dbColumn: string;
  label: string;
  sample: string;
  width: number;
  optional?: boolean;
  format?: "date" | "time";
  operationallyProtected?: boolean;
}

const optional = true;
const operationallyProtected = true;

// 첨부 양식에서 제외 요청된 대기실명·성별을 뺀 열 + OPT1~OPT3.
const candidateFieldDefinitions = [
  { key: "designatedSort", dbColumn: "designated_sort", label: "지정정렬", sample: "1", width: 12, optional },
  { key: "date", dbColumn: "exam_date", label: "시험날짜", sample: "2026-10-30", width: 16, format: "date" },
  { key: "time", dbColumn: "start_time", label: "시험시간", sample: "10:00", width: 12, format: "time" },
  { key: "period", dbColumn: "period_name", label: "교시명", sample: "오전", width: 16 },
  {
    key: "admission",
    dbColumn: "admission",
    label: "전형명",
    sample: "학생부교과 면접",
    width: 20,
    operationallyProtected,
  },
  {
    key: "unit",
    dbColumn: "unit_name",
    label: "모집단위명",
    sample: "유아교육과",
    width: 18,
    operationallyProtected,
  },
  {
    key: "major",
    dbColumn: "major",
    label: "전공명",
    sample: "",
    width: 16,
    optional,
    operationallyProtected,
  },
  {
    key: "building",
    dbColumn: "building_name",
    label: "고사건물명",
    sample: "사범관",
    width: 16,
    operationallyProtected,
  },
  {
    key: "room",
    dbColumn: "room_name",
    label: "고사실명",
    sample: "면접고사실",
    width: 16,
    operationallyProtected,
  },
  { key: "examineeNo", dbColumn: "examinee_no", label: "수험번호", sample: "1162001", width: 18 },
  {
    key: "temporaryNo",
    dbColumn: "temporary_no",
    label: "가번호",
    sample: "01",
    width: 14,
    optional,
    operationallyProtected,
  },
  { key: "name", dbColumn: "name", label: "이름", sample: "이○민", width: 16 },
  {
    key: "birth",
    dbColumn: "birth_date",
    label: "생년월일",
    sample: "2008-07-24",
    width: 16,
    format: "date",
  },
  { key: "group", dbColumn: "group_name", label: "조", sample: "1조", width: 12, optional },
  { key: "opt1", dbColumn: "opt1", label: "OPT1", sample: "", width: 14, optional },
  { key: "opt2", dbColumn: "opt2", label: "OPT2", sample: "", width: 14, optional },
  { key: "opt3", dbColumn: "opt3", label: "OPT3", sample: "", width: 14, optional },
] as const satisfies readonly CandidateFieldDefinitionShape[];

export type CandidateFieldKey = (typeof candidateFieldDefinitions)[number]["key"];
export type CandidateDatabaseColumn = (typeof candidateFieldDefinitions)[number]["dbColumn"];

export interface CandidateFieldDefinition extends Omit<CandidateFieldDefinitionShape, "key" | "dbColumn"> {
  key: CandidateFieldKey;
  dbColumn: CandidateDatabaseColumn;
}

export type CandidateInput = Record<CandidateFieldKey, string>;

export const candidateFields: readonly CandidateFieldDefinition[] = Object.freeze(candidateFieldDefinitions);

export const candidateFieldKeys: readonly CandidateFieldKey[] = Object.freeze(
  candidateFields.map((field) => field.key),
);

export function candidateKey(candidate: Pick<CandidateInput, "examineeNo" | "date" | "time" | "period">) {
  return `${candidate.examineeNo}\u0000${candidate.date}\u0000${candidate.time}\u0000${candidate.period}`;
}
