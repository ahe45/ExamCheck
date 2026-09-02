import { randomUUID } from "node:crypto";
import { validateIdentityRanges, type IdentityRangeValidationInput } from "../database/identity-range-validation.js";
import {
  IdentityTransitionGateRepository,
  identityRelationshipInvariantCodes,
  type IdentityTransitionEvidenceRow,
  type IdentityTransitionGateConnection,
  type IdentityRangeValidationSnapshot,
  type IdentityTransitionRequestRow,
  type IdentityTransitionStateRow,
  type IdentityTransitionTargetState,
} from "./identity-transition-gate.repository.js";
import { IDENTITY_SHADOW_OBSERVATION_TYPES } from "./identity-shadow-snapshot.repository.js";
import type { IdentityReadMode, IdentityTransitionPhase, IdentityWriteMode } from "./identity-transition-state.js";

export const identityTransitionEvidenceTypes = [
  "BACKUP_RESTORE",
  "ROLLBACK_REHEARSAL",
  "TARGET_READ_CONTRACT_READY",
  "TARGET_WRITE_CONTRACT_READY",
  "CANARY_VALIDATION",
  "LEGACY_COMPATIBILITY",
] as const;

export type IdentityTransitionEvidenceType = (typeof identityTransitionEvidenceTypes)[number];
export type IdentityTransitionEvidenceResult = "PASSED" | "FAILED";
export type IdentityTransitionTargetStage = "DUAL" | "SHADOW" | "CANARY" | "CANONICAL";
export type IdentityTransitionApprovalType = "OPERATIONS" | "DATA_OWNER" | "PRIVACY" | "CANONICAL_OWNER";
export type IdentityEmergencyRollbackTarget = "LEGACY" | "DUAL";

export type IdentityTransitionGateErrorCode =
  | "INVALID_INPUT"
  | "REQUEST_NOT_PENDING"
  | "STATE_VERSION_MISMATCH"
  | "INVALID_TRANSITION"
  | "REQUIRED_EVIDENCE_MISSING"
  | "REQUIRED_APPROVAL_MISSING"
  | "APPROVAL_SEPARATION_REQUIRED"
  | "BACKFILL_NOT_SUCCEEDED"
  | "OPEN_BLOCKING_ISSUES"
  | "OBSERVATION_WINDOW_MISSING"
  | "OBSERVATION_THRESHOLD_NOT_MET"
  | "OBSERVATION_WATERMARK_STALE"
  | "SHADOW_COMPARISON_FAILED"
  | "CANARY_TARGET_MISSING"
  | "TARGET_RELATIONSHIP_INVARIANT_FAILED"
  | "RANGE_VALIDATION_FAILED"
  | "ROLLBACK_RTO_EXCEEDED"
  | "MANUAL_CANONICAL_CONFIRMATION_REQUIRED";

export class IdentityTransitionGateError extends Error {
  constructor(
    readonly code: IdentityTransitionGateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IdentityTransitionGateError";
  }
}

export interface RecordTransitionEvidenceInput {
  evidenceId?: string;
  evidenceType: IdentityTransitionEvidenceType;
  result: IdentityTransitionEvidenceResult;
  referenceCode: string;
  elapsedMinutes?: number;
  observedAt: Date;
  validUntil: Date;
  recordedBy: number;
  verifiedBy: number;
}

export interface CreateTransitionRequestInput {
  requestId?: string;
  targetStage: IdentityTransitionTargetStage;
  expectedStateVersion: number;
  reasonCode: string;
  minimumComparedEntityCount?: number;
  minimumObservationMinutes?: number;
  maximumRollbackMinutes: number;
  requestedBy: number;
}

export interface ApplyTransitionRequestInput {
  requestId: string;
  actorUserId: number;
  manualCanonicalConfirmation?: boolean;
}

export interface EmergencyRollbackInput {
  target: IdentityEmergencyRollbackTarget;
  actorUserId: number;
  reasonCode: string;
  maximumRollbackMinutes?: number;
  evidenceIds?: readonly string[];
}

export interface AppliedTransitionState {
  writeMode: IdentityWriteMode;
  readMode: IdentityReadMode;
  phase: IdentityTransitionPhase;
  version: number;
}

const UINT32_MAX = 4_294_967_295;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._:-]{0,127}$/;

const REQUIRED_EVIDENCE: Readonly<Record<IdentityTransitionTargetStage, readonly IdentityTransitionEvidenceType[]>> = {
  DUAL: ["BACKUP_RESTORE", "ROLLBACK_REHEARSAL", "TARGET_WRITE_CONTRACT_READY"],
  SHADOW: ["BACKUP_RESTORE", "ROLLBACK_REHEARSAL", "TARGET_READ_CONTRACT_READY", "TARGET_WRITE_CONTRACT_READY"],
  CANARY: ["BACKUP_RESTORE", "ROLLBACK_REHEARSAL", "TARGET_READ_CONTRACT_READY", "TARGET_WRITE_CONTRACT_READY"],
  CANONICAL: [
    "BACKUP_RESTORE",
    "ROLLBACK_REHEARSAL",
    "TARGET_READ_CONTRACT_READY",
    "TARGET_WRITE_CONTRACT_READY",
    "CANARY_VALIDATION",
    "LEGACY_COMPATIBILITY",
  ],
};

const REQUIRED_APPROVALS: Readonly<Record<IdentityTransitionTargetStage, readonly IdentityTransitionApprovalType[]>> = {
  DUAL: ["OPERATIONS", "DATA_OWNER"],
  SHADOW: ["OPERATIONS", "DATA_OWNER"],
  CANARY: ["OPERATIONS", "DATA_OWNER", "PRIVACY"],
  CANONICAL: ["OPERATIONS", "DATA_OWNER", "PRIVACY", "CANONICAL_OWNER"],
};

export function requiredEvidenceForStage(
  targetStage: IdentityTransitionTargetStage,
): readonly IdentityTransitionEvidenceType[] {
  return REQUIRED_EVIDENCE[targetStage];
}

export function requiredApprovalsForStage(
  targetStage: IdentityTransitionTargetStage,
): readonly IdentityTransitionApprovalType[] {
  return REQUIRED_APPROVALS[targetStage];
}

/**
 * Deliberately not registered as an HTTP/Nest provider. State mutations are available only
 * to the isolated transition CLI and tests until an operational control plane is approved.
 */
export class IdentityTransitionGateService {
  constructor(private readonly repository = new IdentityTransitionGateRepository()) {}

  async recordEvidence(
    connection: IdentityTransitionGateConnection,
    input: RecordTransitionEvidenceInput,
  ): Promise<{ evidenceId: string }> {
    assertEvidenceInput(input);
    const evidenceId = input.evidenceId ?? randomUUID();
    assertUuid(evidenceId, "Evidence IDs must be UUIDs.");
    await this.repository.insertEvidence(connection, evidenceId, input);
    return { evidenceId };
  }

  async createRequest(
    connection: IdentityTransitionGateConnection,
    input: CreateTransitionRequestInput,
  ): Promise<{ requestId: string }> {
    assertRequestInput(input);
    const requestId = input.requestId ?? randomUUID();
    assertUuid(requestId, "Transition request IDs must be UUIDs.");
    return this.inTransaction(connection, async () => {
      const state = await this.loadState(connection, true);
      if (state.version !== input.expectedStateVersion) {
        gateError("STATE_VERSION_MISMATCH", "Transition request state version is stale.");
      }
      assertSourceState(input.targetStage, state);
      await this.repository.insertRequest(connection, requestId, input);
      return { requestId };
    });
  }

  async attachEvidence(
    connection: IdentityTransitionGateConnection,
    input: { requestId: string; evidenceId: string; actorUserId: number },
  ): Promise<void> {
    assertUuid(input.requestId, "Transition request IDs must be UUIDs.");
    assertUuid(input.evidenceId, "Evidence IDs must be UUIDs.");
    assertPositiveSafeInteger(input.actorUserId, "Actor user IDs must be positive safe integers.");
    await this.inTransaction(connection, async () => {
      await this.loadPendingRequest(connection, input.requestId, true);
      if (!(await this.repository.evidenceExists(connection, input.evidenceId))) {
        gateError("REQUIRED_EVIDENCE_MISSING", "Transition evidence does not exist.");
      }
      await this.repository.linkRequestEvidence(connection, input.requestId, input.evidenceId, input.actorUserId);
    });
  }

  async approveRequest(
    connection: IdentityTransitionGateConnection,
    input: { requestId: string; approvalType: IdentityTransitionApprovalType; approvedBy: number },
  ): Promise<void> {
    assertUuid(input.requestId, "Transition request IDs must be UUIDs.");
    assertApprovalType(input.approvalType);
    assertPositiveSafeInteger(input.approvedBy, "Approver user IDs must be positive safe integers.");
    await this.inTransaction(connection, async () => {
      const request = await this.loadPendingRequest(connection, input.requestId, true);
      if (request.requestedBy === input.approvedBy) {
        gateError("APPROVAL_SEPARATION_REQUIRED", "Requesters cannot approve their own transition request.");
      }
      await this.repository.insertApproval(connection, input.requestId, input.approvalType, input.approvedBy);
    });
  }

  async applyRequest(
    connection: IdentityTransitionGateConnection,
    input: ApplyTransitionRequestInput,
  ): Promise<AppliedTransitionState> {
    assertUuid(input.requestId, "Transition request IDs must be UUIDs.");
    assertPositiveSafeInteger(input.actorUserId, "Actor user IDs must be positive safe integers.");
    return this.inTransaction(connection, async () => {
      const state = await this.loadState(connection, true);
      const request = await this.loadPendingRequest(connection, input.requestId, true);
      if (state.version !== request.expectedStateVersion) {
        gateError("STATE_VERSION_MISMATCH", "Transition request state version is stale.");
      }
      assertSourceState(request.targetStage, state);
      if (request.targetStage === "CANONICAL" && input.manualCanonicalConfirmation !== true) {
        gateError(
          "MANUAL_CANONICAL_CONFIRMATION_REQUIRED",
          "Canonical promotion requires an explicit manual confirmation.",
        );
      }

      await this.assertApprovals(connection, request);
      const selectedEvidence = await this.selectRequestEvidence(connection, request);
      await this.assertBackfill(connection, state);
      await this.assertTargetRelationshipInvariants(connection);
      await this.assertCurrentRangePolicy(connection);
      if (request.targetStage === "CANARY" || request.targetStage === "CANONICAL") {
        await this.assertCanaryTargets(connection);
        await this.assertObservationWindow(connection, request, state);
      }

      const target = targetState(request.targetStage);
      const nextVersion = state.version + 1;
      await this.updateState(connection, state, target, nextVersion, input.actorUserId);
      const historyId = await this.insertHistory(connection, {
        requestId: request.id,
        eventType: "PROMOTION",
        state,
        target,
        nextVersion,
        reasonCode: request.reasonCode,
        actorUserId: input.actorUserId,
      });
      await this.linkHistoryEvidence(
        connection,
        historyId,
        [...selectedEvidence.values()].map((row) => row.evidenceId),
      );
      const applied = await this.repository.markRequestApplied(
        connection,
        request.id,
        input.actorUserId,
        request.targetStage === "CANONICAL",
      );
      if (!applied) gateError("REQUEST_NOT_PENDING", "Identity transition request is not pending.");
      return { ...target, version: nextVersion };
    });
  }

  async emergencyRollback(
    connection: IdentityTransitionGateConnection,
    input: EmergencyRollbackInput,
  ): Promise<AppliedTransitionState> {
    assertRollbackInput(input);
    return this.inTransaction(connection, async () => {
      const state = await this.loadState(connection, true);
      assertRollbackSource(input.target, state);
      const required: IdentityTransitionEvidenceType[] = input.target === "DUAL" ? ["TARGET_WRITE_CONTRACT_READY"] : [];
      const selectedEvidence = await this.selectExplicitEvidence(
        connection,
        input.evidenceIds ?? [],
        required,
        input.maximumRollbackMinutes,
      );
      if (input.target === "DUAL") await this.assertBackfill(connection, state);

      const target: IdentityTransitionTargetState =
        input.target === "LEGACY"
          ? { writeMode: "LEGACY", readMode: "LEGACY", phase: "BLOCKED" }
          : { writeMode: "DUAL", readMode: "LEGACY", phase: "BACKFILLED" };
      const nextVersion = state.version + 1;
      await this.updateState(connection, state, target, nextVersion, input.actorUserId);
      const historyId = await this.insertHistory(connection, {
        requestId: null,
        eventType: "EMERGENCY_ROLLBACK",
        state,
        target,
        nextVersion,
        reasonCode: input.reasonCode,
        actorUserId: input.actorUserId,
      });
      await this.linkHistoryEvidence(
        connection,
        historyId,
        [...selectedEvidence.values()].map((row) => row.evidenceId),
      );
      return { ...target, version: nextVersion };
    });
  }

  private async assertApprovals(
    connection: IdentityTransitionGateConnection,
    request: IdentityTransitionRequestRow,
  ): Promise<void> {
    const rows = await this.repository.loadApprovals(connection, request.id);
    const required = REQUIRED_APPROVALS[request.targetStage];
    const byType = new Map(rows.map((row) => [row.approvalType, Number(row.approvedBy)]));
    if (required.some((approval) => !byType.has(approval))) {
      gateError("REQUIRED_APPROVAL_MISSING", "Required transition approvals are incomplete.");
    }
    const requiredActors = required.map((approval) => byType.get(approval)!);
    if (requiredActors.includes(request.requestedBy) || new Set(requiredActors).size !== requiredActors.length) {
      gateError("APPROVAL_SEPARATION_REQUIRED", "Transition approvals must use separated approvers.");
    }
  }

  private async selectRequestEvidence(
    connection: IdentityTransitionGateConnection,
    request: IdentityTransitionRequestRow,
  ): Promise<Map<IdentityTransitionEvidenceType, IdentityTransitionEvidenceRow>> {
    const rows = await this.repository.loadRequestEvidence(connection, request.id);
    return selectRequiredEvidence(rows, REQUIRED_EVIDENCE[request.targetStage], request.maximumRollbackMinutes);
  }

  private async selectExplicitEvidence(
    connection: IdentityTransitionGateConnection,
    evidenceIds: readonly string[],
    required: readonly IdentityTransitionEvidenceType[],
    maximumRollbackMinutes: number | undefined,
  ): Promise<Map<IdentityTransitionEvidenceType, IdentityTransitionEvidenceRow>> {
    if (evidenceIds.length === 0) {
      return selectRequiredEvidence([], required, maximumRollbackMinutes);
    }
    const rows = await this.repository.loadExplicitEvidence(connection, evidenceIds);
    if (required.length === 0) {
      return new Map(rows.map((row) => [row.evidenceType, row]));
    }
    const selected = selectRequiredEvidence(rows, required, maximumRollbackMinutes);
    for (const row of rows) {
      if (!selected.has(row.evidenceType)) selected.set(row.evidenceType, row);
    }
    return selected;
  }

  private async assertBackfill(
    connection: IdentityTransitionGateConnection,
    state: IdentityTransitionStateRow,
  ): Promise<void> {
    if (!state.lastBackfillRunId) {
      gateError("BACKFILL_NOT_SUCCEEDED", "A successful identity backfill is required.");
    }
    const run = await this.repository.loadBackfillRun(connection, state.lastBackfillRunId);
    if (run?.status !== "SUCCEEDED" || !run.completedAt) {
      gateError("BACKFILL_NOT_SUCCEEDED", "A successful identity backfill is required.");
    }
    if ((await this.repository.countOpenIssues(connection, state.lastBackfillRunId)) !== 0) {
      gateError("OPEN_BLOCKING_ISSUES", "Open identity migration issues block transition promotion.");
    }
  }

  private async assertObservationWindow(
    connection: IdentityTransitionGateConnection,
    request: IdentityTransitionRequestRow,
    state: IdentityTransitionStateRow,
  ): Promise<void> {
    const sourcePhase = request.targetStage === "CANARY" ? "SHADOWING" : "CANARY";
    if (state.phase !== sourcePhase) {
      gateError("INVALID_TRANSITION", "Identity transition source phase is invalid.");
    }
    const enteredAt = await this.repository.loadLatestPhaseEntry(connection, sourcePhase);
    if (!enteredAt) {
      gateError("OBSERVATION_WINDOW_MISSING", "The transition observation window has no recorded start.");
    }
    const rows = await this.repository.loadObservationAggregates(
      connection,
      enteredAt,
      IDENTITY_SHADOW_OBSERVATION_TYPES,
    );
    const byType = new Map(rows.map((row) => [row.observationType, row]));
    if (byType.size !== rows.length) {
      gateError("OBSERVATION_WINDOW_MISSING", "Identity shadow observation domains are not unique.");
    }
    for (const observationType of IDENTITY_SHADOW_OBSERVATION_TYPES) {
      const aggregate = byType.get(observationType);
      if (!aggregate) {
        gateError("OBSERVATION_WINDOW_MISSING", "Every identity shadow observation domain is required.");
      }
      const observationCount = Number(aggregate.observationCount);
      const comparedEntityCount = Number(aggregate.comparedEntityCount);
      const firstObservedAt = toDate(aggregate.firstObservedAt);
      const lastObservedAt = toDate(aggregate.lastObservedAt);
      const observedMinutes =
        firstObservedAt && lastObservedAt ? (lastObservedAt.getTime() - firstObservedAt.getTime()) / 60_000 : 0;
      if (
        request.minimumComparedEntityCount === null ||
        request.minimumObservationMinutes === null ||
        !Number.isSafeInteger(observationCount) ||
        observationCount < 1 ||
        !Number.isSafeInteger(comparedEntityCount) ||
        comparedEntityCount < request.minimumComparedEntityCount ||
        observedMinutes < request.minimumObservationMinutes
      ) {
        gateError(
          "OBSERVATION_THRESHOLD_NOT_MET",
          "Every identity shadow domain must meet the explicit sample, entity, and duration thresholds.",
        );
      }
      if (
        Number(aggregate.mismatchCount) !== 0 ||
        Number(aggregate.oldOnlyCount) !== 0 ||
        Number(aggregate.newOnlyCount) !== 0 ||
        Number(aggregate.ambiguousCount) !== 0
      ) {
        gateError("SHADOW_COMPARISON_FAILED", "Identity shadow comparison counts must all be zero in every domain.");
      }
    }
    await this.assertObservationWatermarks(connection, enteredAt);
  }

  private async assertObservationWatermarks(
    connection: IdentityTransitionGateConnection,
    enteredAt: Date | string,
  ): Promise<void> {
    const observedRows = await this.repository.loadLatestCompletedObservationWatermarks(
      connection,
      enteredAt,
      IDENTITY_SHADOW_OBSERVATION_TYPES,
    );
    const currentSourceHighWaterMark = await this.repository.loadCurrentSourceMutationHighWaterMark(connection);
    const observedByType = new Map(observedRows.map((row) => [row.observationType, Number(row.sourceHighWaterMark)]));
    const complete =
      observedRows.length === IDENTITY_SHADOW_OBSERVATION_TYPES.length &&
      observedByType.size === IDENTITY_SHADOW_OBSERVATION_TYPES.length &&
      Number.isSafeInteger(currentSourceHighWaterMark) &&
      currentSourceHighWaterMark >= 0;
    if (
      !complete ||
      IDENTITY_SHADOW_OBSERVATION_TYPES.some((observationType) => {
        const observed = observedByType.get(observationType);
        return (
          observed === undefined ||
          !Number.isSafeInteger(observed) ||
          observed < 0 ||
          observed !== currentSourceHighWaterMark
        );
      })
    ) {
      gateError(
        "OBSERVATION_WATERMARK_STALE",
        "The latest complete identity shadow batch does not cover every current source high-water mark.",
      );
    }
  }

  private async assertTargetRelationshipInvariants(connection: IdentityTransitionGateConnection): Promise<void> {
    const rows = await this.repository.loadRelationshipInvariantAggregates(connection);
    const byCode = new Map(rows.map((row) => [row.invariantCode, Number(row.violationCount)]));
    const complete =
      rows.length === identityRelationshipInvariantCodes.length &&
      byCode.size === identityRelationshipInvariantCodes.length &&
      identityRelationshipInvariantCodes.every((code) => {
        const count = byCode.get(code);
        return count !== undefined && Number.isSafeInteger(count) && count >= 0;
      });
    if (!complete || identityRelationshipInvariantCodes.some((code) => byCode.get(code)! > 0)) {
      gateError(
        "TARGET_RELATIONSHIP_INVARIANT_FAILED",
        "Target identity relationship invariant aggregates must all be present and zero.",
      );
    }
  }

  private async assertCurrentRangePolicy(connection: IdentityTransitionGateConnection): Promise<void> {
    const snapshot = await this.repository.loadRangeValidationSnapshot(connection);
    let inputs: IdentityRangeValidationInput[];
    try {
      inputs = buildRangeValidationInputs(snapshot);
    } catch {
      gateError("RANGE_VALIDATION_FAILED", "Current identity range aggregates are invalid or incomplete.");
    }
    try {
      for (const input of inputs) {
        if (validateIdentityRanges(input).blockingIssueCodes.length > 0) {
          gateError("RANGE_VALIDATION_FAILED", "Current identity ranges overlap or have insufficient union capacity.");
        }
      }
    } catch (error) {
      if (error instanceof IdentityTransitionGateError) throw error;
      gateError("RANGE_VALIDATION_FAILED", "Current identity range aggregates are invalid or incomplete.");
    }
  }

  private async assertCanaryTargets(connection: IdentityTransitionGateConnection): Promise<void> {
    if ((await this.repository.countCanaryTargets(connection)) < 1) {
      gateError("CANARY_TARGET_MISSING", "At least one explicit identity canary target is required.");
    }
  }

  private async loadState(
    connection: IdentityTransitionGateConnection,
    lock: boolean,
  ): Promise<IdentityTransitionStateRow> {
    const state = await this.repository.loadState(connection, lock);
    if (!state) gateError("INVALID_TRANSITION", "Identity transition state is missing.");
    return state;
  }

  private async loadPendingRequest(
    connection: IdentityTransitionGateConnection,
    requestId: string,
    lock: boolean,
  ): Promise<IdentityTransitionRequestRow> {
    const request = await this.repository.loadRequest(connection, requestId, lock);
    if (!request || request.status !== "PENDING") {
      gateError("REQUEST_NOT_PENDING", "Identity transition request is not pending.");
    }
    return request;
  }

  private async updateState(
    connection: IdentityTransitionGateConnection,
    state: IdentityTransitionStateRow,
    target: IdentityTransitionTargetState,
    nextVersion: number,
    actorUserId: number,
  ): Promise<void> {
    if (!(await this.repository.updateState(connection, state, target, nextVersion, actorUserId))) {
      gateError("STATE_VERSION_MISMATCH", "Identity transition state changed concurrently.");
    }
  }

  private async insertHistory(
    connection: IdentityTransitionGateConnection,
    input: {
      requestId: string | null;
      eventType: "PROMOTION" | "EMERGENCY_ROLLBACK";
      state: IdentityTransitionStateRow;
      target: IdentityTransitionTargetState;
      nextVersion: number;
      reasonCode: string;
      actorUserId: number;
    },
  ): Promise<number> {
    return this.repository.insertHistory(connection, input);
  }

  private async linkHistoryEvidence(
    connection: IdentityTransitionGateConnection,
    historyId: number,
    evidenceIds: readonly string[],
  ): Promise<void> {
    await this.repository.linkHistoryEvidence(connection, historyId, evidenceIds);
  }

  private async inTransaction<T>(connection: IdentityTransitionGateConnection, task: () => Promise<T>): Promise<T> {
    await connection.beginTransaction();
    try {
      const result = await task();
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }
}

interface MutableRangeSlot {
  slotId: number;
  targetCount: number;
  segments: Array<{ segmentId: number; start: number; end: number }>;
}

interface MutableRangeAdmission {
  admissionId: number;
  policyScope: "ADMISSION" | "SCHEDULE";
  targetCount: number;
  slots: Map<number, MutableRangeSlot>;
}

function buildRangeValidationInputs(snapshot: IdentityRangeValidationSnapshot): IdentityRangeValidationInput[] {
  const admissions = new Map<number, MutableRangeAdmission>();
  for (const row of snapshot.admissions) {
    const admissionId = toPositiveSafeInteger(row.admissionId);
    const targetCount = toNonNegativeSafeInteger(row.targetCount);
    if ((row.policyScope !== "ADMISSION" && row.policyScope !== "SCHEDULE") || admissions.has(admissionId)) {
      throw new TypeError("Invalid range admission aggregate.");
    }
    admissions.set(admissionId, {
      admissionId,
      policyScope: row.policyScope,
      targetCount,
      slots: new Map(),
    });
  }

  const slotAdmission = new Map<number, number>();
  for (const row of snapshot.slots) {
    const admissionId = toPositiveSafeInteger(row.admissionId);
    const slotId = toPositiveSafeInteger(row.slotId);
    const admission = admissions.get(admissionId);
    if (!admission || slotAdmission.has(slotId)) throw new TypeError("Invalid range slot aggregate.");
    admission.slots.set(slotId, {
      slotId,
      targetCount: toNonNegativeSafeInteger(row.targetCount),
      segments: [],
    });
    slotAdmission.set(slotId, admissionId);
  }

  const segmentIds = new Set<number>();
  for (const row of snapshot.segments) {
    const admissionId = toPositiveSafeInteger(row.admissionId);
    const slotId = toPositiveSafeInteger(row.slotId);
    const segmentId = toPositiveSafeInteger(row.segmentId);
    const admission = admissions.get(admissionId);
    const slot = admission?.slots.get(slotId);
    if (!admission || !slot || slotAdmission.get(slotId) !== admissionId || segmentIds.has(segmentId)) {
      throw new TypeError("Invalid range segment aggregate.");
    }
    slot.segments.push({
      segmentId,
      start: toPositiveSafeInteger(row.rangeStart),
      end: toPositiveSafeInteger(row.rangeEnd),
    });
    segmentIds.add(segmentId);
  }

  return [...admissions.values()].map((admission): IdentityRangeValidationInput => {
    const slots = [...admission.slots.values()];
    if (admission.policyScope === "ADMISSION") {
      return {
        policyScope: "ADMISSION",
        targetCount: admission.targetCount,
        slots: slots.map((slot) => ({ slotId: slot.slotId, segments: slot.segments })),
      };
    }
    return {
      policyScope: "SCHEDULE",
      targetCount: admission.targetCount,
      slots: slots.map((slot) => ({
        slotId: slot.slotId,
        targetCount: slot.targetCount,
        segments: slot.segments,
      })),
    };
  });
}

function toPositiveSafeInteger(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new TypeError("Expected a positive internal ID.");
  return parsed;
}

function toNonNegativeSafeInteger(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError("Expected a non-negative aggregate.");
  return parsed;
}

function selectRequiredEvidence(
  rows: readonly IdentityTransitionEvidenceRow[],
  required: readonly IdentityTransitionEvidenceType[],
  maximumRollbackMinutes: number | undefined,
): Map<IdentityTransitionEvidenceType, IdentityTransitionEvidenceRow> {
  const selected = new Map<IdentityTransitionEvidenceType, IdentityTransitionEvidenceRow>();
  for (const row of rows) {
    if (!selected.has(row.evidenceType)) selected.set(row.evidenceType, row);
  }
  if (required.some((type) => !selected.has(type))) {
    gateError("REQUIRED_EVIDENCE_MISSING", "Required transition evidence is missing, failed, or expired.");
  }
  const rollback = required.includes("ROLLBACK_REHEARSAL") ? selected.get("ROLLBACK_REHEARSAL") : undefined;
  if (
    rollback &&
    (rollback.elapsedMinutes === null ||
      (maximumRollbackMinutes !== undefined && Number(rollback.elapsedMinutes) > maximumRollbackMinutes))
  ) {
    gateError("ROLLBACK_RTO_EXCEEDED", "Rollback rehearsal exceeded the explicit RTO threshold.");
  }
  return new Map(required.map((type) => [type, selected.get(type)!]));
}

function targetState(stage: IdentityTransitionTargetStage): IdentityTransitionTargetState {
  switch (stage) {
    case "DUAL":
      return { writeMode: "DUAL", readMode: "LEGACY", phase: "BACKFILLED" };
    case "SHADOW":
      return { writeMode: "DUAL", readMode: "SHADOW", phase: "SHADOWING" };
    case "CANARY":
      return { writeMode: "DUAL", readMode: "CANARY", phase: "CANARY" };
    case "CANONICAL":
      return { writeMode: "CANONICAL", readMode: "CANONICAL", phase: "CANONICAL" };
  }
}

function assertSourceState(stage: IdentityTransitionTargetStage, state: IdentityTransitionStateRow): void {
  const valid =
    (stage === "DUAL" && state.writeMode === "LEGACY" && state.readMode === "LEGACY" && state.phase === "BACKFILLED") ||
    (stage === "SHADOW" && state.writeMode === "DUAL" && state.readMode === "LEGACY" && state.phase === "BACKFILLED") ||
    (stage === "CANARY" && state.writeMode === "DUAL" && state.readMode === "SHADOW" && state.phase === "SHADOWING") ||
    (stage === "CANONICAL" && state.writeMode === "DUAL" && state.readMode === "CANARY" && state.phase === "CANARY");
  if (!valid) gateError("INVALID_TRANSITION", "Identity transition stages must be promoted in order.");
}

function assertRollbackSource(target: IdentityEmergencyRollbackTarget, state: IdentityTransitionStateRow): void {
  const alreadyLegacy = state.writeMode === "LEGACY" && state.readMode === "LEGACY";
  const alreadyDualLegacy = state.writeMode === "DUAL" && state.readMode === "LEGACY";
  if ((target === "LEGACY" && alreadyLegacy) || (target === "DUAL" && alreadyDualLegacy)) {
    gateError("INVALID_TRANSITION", "Emergency rollback target is already active.");
  }
  if (target === "DUAL" && state.writeMode === "LEGACY") {
    gateError("INVALID_TRANSITION", "Emergency DUAL rollback requires an active target write path.");
  }
}

function assertEvidenceInput(input: RecordTransitionEvidenceInput): void {
  if (!identityTransitionEvidenceTypes.includes(input.evidenceType)) {
    invalidInput("Transition evidence type is invalid.");
  }
  if (input.result !== "PASSED" && input.result !== "FAILED") invalidInput("Evidence result is invalid.");
  assertSafeCode(input.referenceCode, "Evidence reference codes must use safe ASCII characters.");
  assertDate(input.observedAt, "Evidence observation time is invalid.");
  assertDate(input.validUntil, "Evidence validity time is invalid.");
  if (input.observedAt.getTime() > Date.now()) invalidInput("Evidence observation time cannot be in the future.");
  if (input.validUntil.getTime() <= input.observedAt.getTime()) {
    invalidInput("Evidence validity must end after its observation time.");
  }
  assertPositiveSafeInteger(input.recordedBy, "Recorder user IDs must be positive safe integers.");
  assertPositiveSafeInteger(input.verifiedBy, "Verifier user IDs must be positive safe integers.");
  if (input.recordedBy === input.verifiedBy) {
    gateError("APPROVAL_SEPARATION_REQUIRED", "Evidence recorder and verifier must be different users.");
  }
  if (input.evidenceType === "ROLLBACK_REHEARSAL") {
    assertPositiveUint32(input.elapsedMinutes, "Rollback elapsed minutes must be a positive integer.");
  } else if (input.elapsedMinutes !== undefined) {
    invalidInput("Elapsed minutes are only valid for rollback rehearsal evidence.");
  }
}

function assertRequestInput(input: CreateTransitionRequestInput): void {
  if (!(["DUAL", "SHADOW", "CANARY", "CANONICAL"] as const).includes(input.targetStage)) {
    invalidInput("Transition target stage is invalid.");
  }
  assertPositiveUint32(input.expectedStateVersion, "Expected state version must be a positive integer.");
  assertSafeCode(input.reasonCode, "Transition reason codes must use safe ASCII characters.");
  assertPositiveUint32(input.maximumRollbackMinutes, "Maximum rollback minutes must be a positive integer.");
  assertPositiveSafeInteger(input.requestedBy, "Requester user IDs must be positive safe integers.");
  const requiresObservations = input.targetStage === "CANARY" || input.targetStage === "CANONICAL";
  if (requiresObservations) {
    assertPositiveSafeInteger(
      input.minimumComparedEntityCount ?? 0,
      "Minimum compared entity count must be a positive safe integer.",
    );
    assertPositiveUint32(input.minimumObservationMinutes, "Minimum observation minutes must be a positive integer.");
  } else if (input.minimumComparedEntityCount !== undefined || input.minimumObservationMinutes !== undefined) {
    invalidInput("Observation thresholds are only valid for CANARY or CANONICAL promotion.");
  }
}

function assertRollbackInput(input: EmergencyRollbackInput): void {
  if (input.target !== "LEGACY" && input.target !== "DUAL") invalidInput("Rollback target is invalid.");
  assertPositiveSafeInteger(input.actorUserId, "Actor user IDs must be positive safe integers.");
  assertSafeCode(input.reasonCode, "Rollback reason codes must use safe ASCII characters.");
  if (input.maximumRollbackMinutes !== undefined) {
    assertPositiveUint32(input.maximumRollbackMinutes, "Maximum rollback minutes must be a positive integer.");
  }
  for (const evidenceId of input.evidenceIds ?? []) assertUuid(evidenceId, "Evidence IDs must be UUIDs.");
}

function assertApprovalType(value: IdentityTransitionApprovalType): void {
  if (!(<readonly string[]>["OPERATIONS", "DATA_OWNER", "PRIVACY", "CANONICAL_OWNER"]).includes(value)) {
    invalidInput("Transition approval type is invalid.");
  }
}

function assertSafeCode(value: string, message: string): void {
  if (!SAFE_CODE_PATTERN.test(value)) invalidInput(message);
}

function assertUuid(value: string, message: string): void {
  if (!UUID_PATTERN.test(value)) invalidInput(message);
}

function assertDate(value: Date, message: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) invalidInput(message);
}

function assertPositiveSafeInteger(value: number, message: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) invalidInput(message);
}

function assertPositiveUint32(value: number | undefined, message: string): void {
  if (value === undefined || !Number.isInteger(value) || value <= 0 || value > UINT32_MAX) invalidInput(message);
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function invalidInput(message: string): never {
  return gateError("INVALID_INPUT", message);
}

function gateError(code: IdentityTransitionGateErrorCode, message: string): never {
  throw new IdentityTransitionGateError(code, message);
}
