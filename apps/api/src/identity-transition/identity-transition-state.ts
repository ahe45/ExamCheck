import { Inject, Injectable } from "@nestjs/common";
import type { RowDataPacket } from "mysql2/promise";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";

export type IdentityWriteMode = "LEGACY" | "DUAL" | "CANONICAL";
export type IdentityReadMode = "LEGACY" | "SHADOW" | "CANARY" | "CANONICAL";
export type IdentityTransitionPhase =
  "EXPANDED" | "BACKFILLING" | "BACKFILLED" | "SHADOWING" | "CANARY" | "CANONICAL" | "BLOCKED";

export interface IdentityTransitionRuntimeState {
  enabled: boolean;
  writeMode: IdentityWriteMode;
  readMode: IdentityReadMode;
  phase: IdentityTransitionPhase;
  version: number;
  shadowHmacSecret: string | null;
}

interface IdentityTransitionStateRow extends RowDataPacket {
  writeMode: IdentityWriteMode;
  readMode: IdentityReadMode;
  phase: IdentityTransitionPhase;
  version: number;
}

interface ExistsRow extends RowDataPacket {
  selected: number;
}

@Injectable()
export class IdentityTransitionStateRepository {
  constructor(@Inject(APP_CONFIG) private readonly config: Readonly<AppConfig>) {}

  async lockForMutation(executor: SqlExecutor): Promise<IdentityTransitionRuntimeState> {
    return this.load(executor, true);
  }

  async loadForRead(executor: SqlExecutor): Promise<IdentityTransitionRuntimeState> {
    return this.load(executor, false);
  }

  shouldWriteTarget(state: IdentityTransitionRuntimeState): boolean {
    return state.enabled && (state.writeMode === "DUAL" || state.writeMode === "CANONICAL");
  }

  shouldWriteLegacy(state: IdentityTransitionRuntimeState): boolean {
    return !state.enabled || state.writeMode === "LEGACY" || state.writeMode === "DUAL";
  }

  requiresShadowComparison(state: IdentityTransitionRuntimeState): boolean {
    return state.enabled && (state.readMode === "SHADOW" || state.readMode === "CANARY");
  }

  async isCanarySelected(executor: SqlExecutor, userId: number, admissionId?: number): Promise<boolean> {
    const [rows] = await executor.execute<ExistsRow[]>(
      `SELECT CASE WHEN EXISTS (
         SELECT 1 FROM identity_canary_user WHERE user_id = ?
       ) OR (? IS NOT NULL AND EXISTS (
         SELECT 1 FROM identity_canary_admission WHERE admission_id = ?
       )) THEN 1 ELSE 0 END AS selected`,
      [userId, admissionId ?? null, admissionId ?? null],
    );
    return Number(rows[0]?.selected ?? 0) === 1;
  }

  private async load(executor: SqlExecutor, lock: boolean): Promise<IdentityTransitionRuntimeState> {
    if (!this.config.identityTransition.enabled) return disabledState();
    const [rows] = await executor.query<IdentityTransitionStateRow[]>(
      `SELECT write_mode AS writeMode, read_mode AS readMode, phase, version
       FROM identity_transition_state WHERE id = 1${lock ? " LOCK IN SHARE MODE" : ""}`,
    );
    const row = rows[0];
    if (!row) throw new Error("Identity transition state is missing.");
    assertStateCombination(row);
    if ((row.readMode === "SHADOW" || row.readMode === "CANARY") && !this.config.identityTransition.shadowHmacSecret) {
      throw new Error("Identity shadow reads require IDENTITY_SHADOW_HMAC_SECRET.");
    }
    return {
      enabled: true,
      writeMode: row.writeMode,
      readMode: row.readMode,
      phase: row.phase,
      version: Number(row.version),
      shadowHmacSecret: this.config.identityTransition.shadowHmacSecret,
    };
  }
}

function disabledState(): IdentityTransitionRuntimeState {
  return {
    enabled: false,
    writeMode: "LEGACY",
    readMode: "LEGACY",
    phase: "EXPANDED",
    version: 0,
    shadowHmacSecret: null,
  };
}

function assertStateCombination(row: IdentityTransitionStateRow): void {
  if (row.phase === "BLOCKED" && (row.writeMode !== "LEGACY" || row.readMode !== "LEGACY")) {
    throw new Error("Blocked identity transitions must use legacy reads and writes.");
  }
  if (row.writeMode === "CANONICAL" && row.phase !== "CANONICAL") {
    throw new Error("Canonical identity writes require the CANONICAL transition phase.");
  }
  if (row.readMode === "CANONICAL" && row.phase !== "CANONICAL") {
    throw new Error("Canonical identity reads require the CANONICAL transition phase.");
  }
  if (row.readMode === "CANARY" && row.phase !== "CANARY" && row.phase !== "CANONICAL") {
    throw new Error("Canary identity reads require the CANARY transition phase.");
  }
}
