import type { CandidateRecord } from "../../shared/api/candidates";
import type { PseudonymAssignmentMethod, PseudonymSetting } from "../../shared/api/pseudonyms";

export interface AdmissionCardData {
  name: string;
  candidates: number;
  dates: number;
  schedules: number;
  buildings: string[];
  setting: PseudonymSetting | null;
  error: boolean;
}

export function groupAdmissions(candidates: CandidateRecord[]): Omit<AdmissionCardData, "setting" | "error">[] {
  const groups = new Map<
    string,
    { candidates: number; dates: Set<string>; schedules: Set<string>; buildings: Set<string> }
  >();
  for (const candidate of candidates) {
    const name = candidate.admission.trim();
    if (!name) continue;
    const group = groups.get(name) ?? {
      candidates: 0,
      dates: new Set<string>(),
      schedules: new Set<string>(),
      buildings: new Set<string>(),
    };
    group.candidates += 1;
    if (candidate.date.trim()) group.dates.add(candidate.date.trim());
    group.schedules.add([candidate.date, candidate.time, candidate.period].join("|"));
    if (candidate.building.trim()) group.buildings.add(candidate.building.trim());
    groups.set(name, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "ko"))
    .map(([name, group]) => ({
      name,
      candidates: group.candidates,
      dates: group.dates.size,
      schedules: group.schedules.size,
      buildings: [...group.buildings].sort((left, right) => left.localeCompare(right, "ko")),
    }));
}

export function assignmentMethodLabel(method: PseudonymAssignmentMethod) {
  if (method === "DRAW") return "추첨";
  if (method === "SEQUENTIAL") return "순차부여";
  if (method === "MATCHING") return "매칭";
  return "사전부여";
}

export function assignmentMethodDetail(setting: PseudonymSetting) {
  if (setting.assignmentMethod === "DRAW") {
    return setting.autoDrawEnabled
      ? `자동 추첨 · ${setting.autoDrawDelaySeconds}초 지연`
      : "수험번호 조회 후 직접 추첨";
  }
  if (setting.assignmentMethod === "SEQUENTIAL") return "가번호 범위 순서대로 부여";
  if (setting.assignmentMethod === "MATCHING") return "가번호를 직접 입력하여 매칭";
  return `기등록 가번호 사용 · 라벨 ${setting.printPreassignedLabel ? "출력" : "미출력"}`;
}

export function rangeSummary(setting: PseudonymSetting) {
  if (setting.assignmentMethod !== "DRAW" && setting.assignmentMethod !== "SEQUENTIAL") {
    return setting.assignmentMethod === "PREASSIGNED"
      ? `라벨 출력 ${setting.printPreassignedLabel ? "사용" : "미사용"}`
      : "수험번호 인식 후 직접 매칭";
  }
  const count = setting.rangeStatistics?.count ?? setting.ranges.length;
  if (!count) return "등록된 가번호 범위가 없습니다.";
  const start = setting.rangeStatistics?.start ?? Math.min(...setting.ranges.map((range) => range.rangeStart));
  const end = setting.rangeStatistics?.end ?? Math.max(...setting.ranges.map((range) => range.rangeEnd));
  return `${count.toLocaleString()}개 범위 · ${start.toLocaleString()} ~ ${end.toLocaleString()}`;
}
