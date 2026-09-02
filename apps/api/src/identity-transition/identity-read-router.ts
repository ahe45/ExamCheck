import { Inject, Injectable } from "@nestjs/common";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { compareIdentityProjections, type IdentityShadowReport, type ShadowProjectionRow } from "./identity-shadow.js";
import { IdentityShadowObservationRepository } from "./identity-shadow-observation.repository.js";
import { IdentityTransitionStateRepository, type IdentityTransitionRuntimeState } from "./identity-transition-state.js";

export type IdentityReadSource = "LEGACY" | "TARGET";

export interface IdentityReadContext {
  userId: number;
  admissionId?: number;
}

export interface IdentityReadDecision {
  state: IdentityTransitionRuntimeState;
  readLegacy: boolean;
  readTarget: boolean;
  compare: boolean;
  responseSource: IdentityReadSource;
  canarySelected: boolean;
}

export interface IdentityReadProjection<T> {
  value: T;
  rows: readonly ShadowProjectionRow[];
}

export interface IdentityReadRouteRequest<T> extends IdentityReadContext {
  observationType: string;
  sourceHighWaterMark?: number;
  legacy: () => Promise<IdentityReadProjection<T>>;
  target: () => Promise<IdentityReadProjection<T>>;
}

export interface IdentityReadRouteResult<T> {
  value: T;
  decision: IdentityReadDecision;
  comparison?: IdentityShadowReport;
}

export interface FailClosedAdmissionAccess {
  allowedAdmissionIds: readonly number[];
  matches: boolean;
  legacyOnlyCount: number;
  targetOnlyCount: number;
}

@Injectable()
export class IdentityReadRouter {
  constructor(
    @Inject(IdentityTransitionStateRepository)
    private readonly stateRepository: IdentityTransitionStateRepository,
    @Inject(IdentityShadowObservationRepository)
    private readonly observationRepository: IdentityShadowObservationRepository,
  ) {}

  async decide(executor: SqlExecutor, context: IdentityReadContext): Promise<IdentityReadDecision> {
    assertPositiveId(context.userId, "user ID");
    if (context.admissionId !== undefined) assertPositiveId(context.admissionId, "admission ID");
    const state = await this.stateRepository.loadForRead(executor);

    switch (state.readMode) {
      case "LEGACY":
        return decision(state, true, false, false, "LEGACY", false);
      case "SHADOW":
        return decision(state, true, true, true, "LEGACY", false);
      case "CANARY": {
        const selected = await this.stateRepository.isCanarySelected(executor, context.userId, context.admissionId);
        return decision(state, true, true, true, selected ? "TARGET" : "LEGACY", selected);
      }
      case "CANONICAL":
        return decision(state, false, true, false, "TARGET", false);
    }
  }

  /** Runs both SHADOW/CANARY projections on the caller-owned connection/snapshot. */
  async route<T>(executor: SqlExecutor, request: IdentityReadRouteRequest<T>): Promise<IdentityReadRouteResult<T>> {
    const routed = await this.decide(executor, request);
    const legacy = routed.readLegacy ? await request.legacy() : undefined;
    const target = routed.readTarget ? await request.target() : undefined;

    let comparison: IdentityShadowReport | undefined;
    if (routed.compare) {
      if (!legacy || !target || !routed.state.shadowHmacSecret) {
        throw new Error("Shadow identity reads require both projections and an HMAC secret.");
      }
      comparison = compareIdentityProjections(legacy.rows, target.rows, routed.state.shadowHmacSecret);
      const sourceHighWaterMark =
        request.sourceHighWaterMark ?? (await this.observationRepository.loadSourceMutationHighWaterMark(executor));
      await this.observationRepository.record(executor, {
        observationType: request.observationType,
        sourceHighWaterMark,
        report: comparison,
      });
    }

    const selected = routed.responseSource === "LEGACY" ? legacy : target;
    if (!selected) throw new Error(`The ${routed.responseSource.toLowerCase()} identity projection was not loaded.`);
    return {
      value: selected.value,
      decision: routed,
      ...(comparison ? { comparison } : {}),
    };
  }
}

/**
 * Both inputs must be concrete admission IDs (expand any wildcard/all-access marker first).
 * On disagreement only the intersection survives, so a transition cannot widen access.
 */
export function resolveFailClosedAdmissionAccess(
  legacyAdmissionIds: readonly number[],
  targetAdmissionIds: readonly number[],
): FailClosedAdmissionAccess {
  const legacy = normalizedIdSet(legacyAdmissionIds);
  const target = normalizedIdSet(targetAdmissionIds);
  const allowedAdmissionIds = [...legacy].filter((id) => target.has(id)).sort((left, right) => left - right);
  return {
    allowedAdmissionIds,
    matches: legacy.size === target.size && allowedAdmissionIds.length === legacy.size,
    legacyOnlyCount: [...legacy].filter((id) => !target.has(id)).length,
    targetOnlyCount: [...target].filter((id) => !legacy.has(id)).length,
  };
}

function decision(
  state: IdentityTransitionRuntimeState,
  readLegacy: boolean,
  readTarget: boolean,
  compare: boolean,
  responseSource: IdentityReadSource,
  canarySelected: boolean,
): IdentityReadDecision {
  return { state, readLegacy, readTarget, compare, responseSource, canarySelected };
}

function normalizedIdSet(ids: readonly number[]): Set<number> {
  for (const id of ids) assertPositiveId(id, "admission ID");
  return new Set(ids);
}

function assertPositiveId(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`Identity transition ${label} must be a positive safe integer.`);
  }
}
