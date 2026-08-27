import { createHmac } from "node:crypto";
import { IDENTITY_TRANSITION_REPORT_SCHEMA_VERSION } from "./identity-dry-run.js";

export type ShadowProjectionValue =
  | null
  | boolean
  | number
  | string
  | readonly ShadowProjectionValue[]
  | { readonly [key: string]: ShadowProjectionValue };

export interface ShadowProjectionRow {
  entityId: number;
  projection: Readonly<Record<string, ShadowProjectionValue>>;
}

export type ShadowComparisonStatus = "MATCH" | "MISMATCH" | "OLD_ONLY" | "NEW_ONLY" | "AMBIGUOUS";

export interface ShadowComparisonEntry {
  entityId: number;
  status: ShadowComparisonStatus;
  oldRowCount: number;
  newRowCount: number;
  oldDigest?: string;
  newDigest?: string;
}

export interface IdentityShadowReport {
  schemaVersion: typeof IDENTITY_TRANSITION_REPORT_SCHEMA_VERSION;
  digestAlgorithm: "hmac-sha256";
  oldRowCount: number;
  newRowCount: number;
  entityCount: number;
  counts: {
    match: number;
    mismatch: number;
    oldOnly: number;
    newOnly: number;
    ambiguous: number;
  };
  entries: readonly ShadowComparisonEntry[];
}

export function compareIdentityProjections(
  oldRows: readonly ShadowProjectionRow[],
  newRows: readonly ShadowProjectionRow[],
  salt: string,
): IdentityShadowReport {
  assertSalt(salt);
  assertEntityIds([...oldRows, ...newRows]);

  const oldById = groupRowsByEntityId(oldRows);
  const newById = groupRowsByEntityId(newRows);
  const entityIds = [...new Set([...oldById.keys(), ...newById.keys()])].sort((left, right) => left - right);
  const entries = entityIds.map((entityId) =>
    compareEntity(entityId, oldById.get(entityId) ?? [], newById.get(entityId) ?? [], salt),
  );

  return {
    schemaVersion: IDENTITY_TRANSITION_REPORT_SCHEMA_VERSION,
    digestAlgorithm: "hmac-sha256",
    oldRowCount: oldRows.length,
    newRowCount: newRows.length,
    entityCount: entityIds.length,
    counts: {
      match: entries.filter((entry) => entry.status === "MATCH").length,
      mismatch: entries.filter((entry) => entry.status === "MISMATCH").length,
      oldOnly: entries.filter((entry) => entry.status === "OLD_ONLY").length,
      newOnly: entries.filter((entry) => entry.status === "NEW_ONLY").length,
      ambiguous: entries.filter((entry) => entry.status === "AMBIGUOUS").length,
    },
    entries,
  };
}

export function createProjectionDigest(
  entityId: number,
  projection: Readonly<Record<string, ShadowProjectionValue>>,
  salt: string,
): string {
  assertSalt(salt);
  if (!Number.isSafeInteger(entityId) || entityId <= 0) {
    throw new TypeError("Shadow projection entity IDs must be positive safe integers.");
  }
  return createHmac("sha256", salt)
    .update("identity-transition-shadow:v1\u0000")
    .update(String(entityId))
    .update("\u0000")
    .update(stableSerialize(projection))
    .digest("hex");
}

function compareEntity(
  entityId: number,
  oldRows: readonly ShadowProjectionRow[],
  newRows: readonly ShadowProjectionRow[],
  salt: string,
): ShadowComparisonEntry {
  if (oldRows.length > 1 || newRows.length > 1) {
    return {
      entityId,
      status: "AMBIGUOUS",
      oldRowCount: oldRows.length,
      newRowCount: newRows.length,
      ...(oldRows.length === 1 ? { oldDigest: createProjectionDigest(entityId, oldRows[0]!.projection, salt) } : {}),
      ...(newRows.length === 1 ? { newDigest: createProjectionDigest(entityId, newRows[0]!.projection, salt) } : {}),
    };
  }
  if (oldRows.length === 0) {
    return {
      entityId,
      status: "NEW_ONLY",
      oldRowCount: 0,
      newRowCount: 1,
      newDigest: createProjectionDigest(entityId, newRows[0]!.projection, salt),
    };
  }
  if (newRows.length === 0) {
    return {
      entityId,
      status: "OLD_ONLY",
      oldRowCount: 1,
      newRowCount: 0,
      oldDigest: createProjectionDigest(entityId, oldRows[0]!.projection, salt),
    };
  }

  const oldDigest = createProjectionDigest(entityId, oldRows[0]!.projection, salt);
  const newDigest = createProjectionDigest(entityId, newRows[0]!.projection, salt);
  return {
    entityId,
    status: oldDigest === newDigest ? "MATCH" : "MISMATCH",
    oldRowCount: 1,
    newRowCount: 1,
    oldDigest,
    newDigest,
  };
}

function groupRowsByEntityId(rows: readonly ShadowProjectionRow[]): Map<number, ShadowProjectionRow[]> {
  const result = new Map<number, ShadowProjectionRow[]>();
  for (const row of rows) {
    const values = result.get(row.entityId) ?? [];
    values.push(row);
    result.set(row.entityId, values);
  }
  return result;
}

function stableSerialize(value: ShadowProjectionValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Shadow projections may only contain finite numbers.");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
}

function assertSalt(salt: string): void {
  if (Buffer.byteLength(salt, "utf8") < 16) {
    throw new TypeError("Shadow comparison salt must contain at least 16 bytes.");
  }
}

function assertEntityIds(rows: readonly ShadowProjectionRow[]): void {
  if (rows.some((row) => !Number.isSafeInteger(row.entityId) || row.entityId <= 0)) {
    throw new TypeError("Shadow projection entity IDs must be positive safe integers.");
  }
}
