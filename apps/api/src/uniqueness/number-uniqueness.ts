import { createHash } from "node:crypto";

export type ExamineeNoUniqueness = "SYSTEM" | "SCHEDULE";
export type PseudonymNoUniqueness = "ADMISSION" | "SCHEDULE";

export interface NumberUniquenessPolicy {
  examineeNoUniqueness: ExamineeNoUniqueness;
  pseudonymNoUniqueness: PseudonymNoUniqueness;
}

export interface PseudonymScheduleScope {
  date: string;
  time: string;
  period: string;
  admission: string;
}

export function pseudonymUniquenessScopeKey(policy: PseudonymNoUniqueness, scope: PseudonymScheduleScope) {
  if (policy === "ADMISSION") return "";
  return createHash("sha256")
    .update([scope.date, scope.time, scope.period, scope.admission].join("\u001f"))
    .digest("hex");
}
