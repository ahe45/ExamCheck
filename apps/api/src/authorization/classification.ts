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

export const DELETED_SCOPE_GRANT = "!";

interface ScopeGrant {
  method: string;
  scopeKey: string;
  legacy?: boolean;
}

export function resolveClassifiedAccess(grants: ScopeGrant[], method: ClassificationMethod) {
  const current = grants.filter((grant) => grant.method === method);
  const restricted = ({ legacy, scopeKey }: ScopeGrant) => legacy || scopeKey !== "*";
  const deleted = ({ legacy, scopeKey }: ScopeGrant) => !legacy && scopeKey === DELETED_SCOPE_GRANT;
  const admissionNames = current.filter((grant) => restricted(grant) && !deleted(grant)).map((grant) => grant.scopeKey);
  const unrestricted = !current.some(deleted) && current.some((grant) => !restricted(grant));
  return { admissionNames, scopeBlocked: admissionNames.length === 0 && !unrestricted && grants.some(restricted) };
}

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
