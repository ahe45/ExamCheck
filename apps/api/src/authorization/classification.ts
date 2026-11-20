import { createHash } from "node:crypto";
import type { CandidateInput } from "../candidates/candidate-fields.js";

export const CLASSIFICATION_METHODS = [
  "NONE",
  "ADMISSION",
  "UNIT",
  "MAJOR",
  "BUILDING",
  "ROOM",
  "WAITING_ROOM",
  "DATE",
  "PERIOD",
  "GROUP",
] as const;

export type ClassificationMethod = (typeof CLASSIFICATION_METHODS)[number];

// The identity projection handles physical admission scopes.
export const CLASSIFICATION_SCOPE_SQL_PATTERN = `^~(${CLASSIFICATION_METHODS.filter((method) => method !== "ADMISSION").join("|")}):[0-9a-f]{64}$`;
const scopeKeyPattern = new RegExp(CLASSIFICATION_SCOPE_SQL_PATTERN);

export function classificationOfScope(scope: string): ClassificationMethod {
  return (scopeKeyPattern.exec(scope)?.[1] as ClassificationMethod | undefined) ?? "ADMISSION";
}

export function isClassifiedScope(scope: string): boolean {
  return classificationOfScope(scope) !== "ADMISSION";
}

export function matchesClassificationMethod(scope: string, method: ClassificationMethod): boolean {
  const encoded = scopeKeyPattern.exec(scope);
  return method === "ADMISSION" ? !encoded : encoded?.[1] === method;
}
export function candidateClassificationScope(candidate: CandidateInput, method: ClassificationMethod): string {
  const room = (name: string) =>
    name.trim() ? [candidate.building.trim(), name.trim()].filter(Boolean).join("\u001f") : "";
  const values = {
    NONE: "",
    UNIT: candidate.unit,
    MAJOR: candidate.major,
    BUILDING: candidate.building,
    ROOM: room(candidate.room),
    WAITING_ROOM: room(candidate.waitingRoom),
    DATE: candidate.date,
    PERIOD: candidate.period,
    GROUP: candidate.group,
  };
  if (method === "ADMISSION") return candidate.admission;
  return `~${method}:${createHash("sha256").update(values[method].trim()).digest("hex")}`;
}
