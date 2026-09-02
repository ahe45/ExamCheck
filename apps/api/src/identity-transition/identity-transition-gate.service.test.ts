import { describe, expect, it, vi } from "vitest";
import type { Connection, ResultSetHeader } from "mysql2/promise";
import {
  IdentityTransitionGateService,
  requiredApprovalsForStage,
  requiredEvidenceForStage,
} from "./identity-transition-gate.service.js";
import {
  IdentityTransitionGateRepository,
  identityRelationshipInvariantCodes,
  type IdentityObservationAggregateRow,
  type IdentityObservationWatermarkRow,
  type IdentityRangeValidationSnapshot,
} from "./identity-transition-gate.repository.js";
import { IDENTITY_SHADOW_OBSERVATION_TYPES } from "./identity-shadow-snapshot.repository.js";

describe("identity transition gate service", () => {
  it("requires target read and write contracts before user-visible or canonical reads", () => {
    expect(requiredEvidenceForStage("CANARY")).toEqual([
      "BACKUP_RESTORE",
      "ROLLBACK_REHEARSAL",
      "TARGET_READ_CONTRACT_READY",
      "TARGET_WRITE_CONTRACT_READY",
    ]);
    expect(requiredEvidenceForStage("CANONICAL")).toEqual([
      "BACKUP_RESTORE",
      "ROLLBACK_REHEARSAL",
      "TARGET_READ_CONTRACT_READY",
      "TARGET_WRITE_CONTRACT_READY",
      "CANARY_VALIDATION",
      "LEGACY_COMPATIBILITY",
    ]);
    expect(requiredApprovalsForStage("CANONICAL")).toEqual(["OPERATIONS", "DATA_OWNER", "PRIVACY", "CANONICAL_OWNER"]);
  });

  it("records only structured evidence with separated recorder and verifier", async () => {
    const service = new IdentityTransitionGateService();
    const connection = fakeConnection();
    const observedAt = new Date("2026-08-28T00:00:00.000Z");
    const validUntil = new Date("2026-08-29T00:00:00.000Z");

    await expect(
      service.recordEvidence(connection, {
        evidenceId: "10000000-0000-4000-8000-000000000001",
        evidenceType: "BACKUP_RESTORE",
        result: "PASSED",
        referenceCode: "CHANGE:RESTORE-1",
        observedAt,
        validUntil,
        recordedBy: 1,
        verifiedBy: 2,
      }),
    ).resolves.toEqual({ evidenceId: "10000000-0000-4000-8000-000000000001" });
    expect(connection.execute).toHaveBeenCalledWith(expect.stringContaining("identity_transition_gate_evidence"), [
      "10000000-0000-4000-8000-000000000001",
      "BACKUP_RESTORE",
      "PASSED",
      "CHANGE:RESTORE-1",
      null,
      observedAt,
      validUntil,
      1,
      2,
    ]);

    await expect(
      service.recordEvidence(connection, {
        evidenceType: "BACKUP_RESTORE",
        result: "PASSED",
        referenceCode: "CHANGE:RESTORE-2",
        observedAt,
        validUntil,
        recordedBy: 1,
        verifiedBy: 1,
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_SEPARATION_REQUIRED" });

    await expect(
      service.recordEvidence(connection, {
        evidenceType: "BACKUP_RESTORE",
        result: "PASSED",
        referenceCode: "CHANGE:FUTURE",
        observedAt: new Date(Date.now() + 60_000),
        validUntil: new Date(Date.now() + 120_000),
        recordedBy: 1,
        verifiedBy: 2,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("requires explicit observation and rollback thresholds", async () => {
    const service = new IdentityTransitionGateService();
    const connection = fakeConnection({
      state: state({ writeMode: "DUAL", readMode: "SHADOW", phase: "SHADOWING", version: 4 }),
    });

    await expect(
      service.createRequest(connection, {
        targetStage: "CANARY",
        expectedStateVersion: 4,
        reasonCode: "PROMOTE:CANARY",
        maximumRollbackMinutes: 15,
        requestedBy: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(
      service.createRequest(connection, {
        targetStage: "CANARY",
        expectedStateVersion: 4,
        reasonCode: "PROMOTE:CANARY",
        minimumComparedEntityCount: 10,
        minimumObservationMinutes: 30,
        maximumRollbackMinutes: 0,
        requestedBy: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects stale or out-of-order requests before writing them", async () => {
    const service = new IdentityTransitionGateService();
    const stale = fakeConnection({ state: state({ phase: "BACKFILLED", version: 3 }) });
    await expect(
      service.createRequest(stale, {
        targetStage: "DUAL",
        expectedStateVersion: 2,
        reasonCode: "PROMOTE:DUAL",
        maximumRollbackMinutes: 15,
        requestedBy: 1,
      }),
    ).rejects.toMatchObject({ code: "STATE_VERSION_MISMATCH" });
    expect(stale.rollback).toHaveBeenCalledOnce();

    const wrongOrder = fakeConnection({ state: state({ phase: "BACKFILLED", version: 3 }) });
    await expect(
      service.createRequest(wrongOrder, {
        targetStage: "SHADOW",
        expectedStateVersion: 3,
        reasonCode: "PROMOTE:SHADOW",
        maximumRollbackMinutes: 15,
        requestedBy: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("never applies CANONICAL without an explicit manual confirmation", async () => {
    const requestId = "20000000-0000-4000-8000-000000000001";
    const connection = fakeConnection({
      state: state({ writeMode: "DUAL", readMode: "CANARY", phase: "CANARY", version: 8 }),
      request: {
        id: requestId,
        targetStage: "CANONICAL",
        status: "PENDING",
        expectedStateVersion: 8,
        reasonCode: "PROMOTE:CANONICAL",
        minimumComparedEntityCount: 100,
        minimumObservationMinutes: 60,
        maximumRollbackMinutes: 15,
        requestedBy: 1,
      },
    });

    await expect(
      new IdentityTransitionGateService().applyRequest(connection, {
        requestId,
        actorUserId: 2,
      }),
    ).rejects.toMatchObject({ code: "MANUAL_CANONICAL_CONFIRMATION_REQUIRED" });
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("always permits an audited emergency LEGACY rollback without gate evidence", async () => {
    const connection = fakeConnection({
      state: state({ writeMode: "DUAL", readMode: "SHADOW", phase: "SHADOWING", version: 5 }),
    });

    await expect(
      new IdentityTransitionGateService().emergencyRollback(connection, {
        target: "LEGACY",
        actorUserId: 2,
        reasonCode: "INCIDENT:FAILSAFE",
      }),
    ).resolves.toEqual({ writeMode: "LEGACY", readMode: "LEGACY", phase: "BLOCKED", version: 6 });
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it("requires a qualifying observation window for every identity shadow domain", async () => {
    const repository = canaryRepository({
      observations: qualifyingObservations().slice(0, -1),
    });

    await expect(
      new IdentityTransitionGateService(repository).applyRequest(fakeConnection(), {
        requestId: CANARY_REQUEST_ID,
        actorUserId: 5,
      }),
    ).rejects.toMatchObject({ code: "OBSERVATION_WINDOW_MISSING" });
  });

  it("fails closed when any target relationship invariant is non-zero", async () => {
    const invariants = zeroInvariantAggregates();
    invariants[1] = { ...invariants[1]!, violationCount: 1 };

    await expect(
      new IdentityTransitionGateService(canaryRepository({ invariants })).applyRequest(fakeConnection(), {
        requestId: CANARY_REQUEST_ID,
        actorUserId: 5,
      }),
    ).rejects.toMatchObject({ code: "TARGET_RELATIONSHIP_INVARIANT_FAILED" });
  });

  it("recalculates current range overlap and union capacity before promotion", async () => {
    const rangeSnapshot: IdentityRangeValidationSnapshot = {
      admissions: [{ admissionId: 1, policyScope: "ADMISSION", targetCount: 2 }] as never,
      slots: [{ admissionId: 1, slotId: 10, targetCount: 2 }] as never,
      segments: [
        { admissionId: 1, slotId: 10, segmentId: 100, rangeStart: 1, rangeEnd: 1 },
        { admissionId: 1, slotId: 10, segmentId: 101, rangeStart: 1, rangeEnd: 2 },
      ] as never,
    };

    await expect(
      new IdentityTransitionGateService(canaryRepository({ rangeSnapshot })).applyRequest(fakeConnection(), {
        requestId: CANARY_REQUEST_ID,
        actorUserId: 5,
      }),
    ).rejects.toMatchObject({ code: "RANGE_VALIDATION_FAILED" });
  });

  it("blocks promotion when the latest complete shadow batch is behind a current source watermark", async () => {
    await expect(
      new IdentityTransitionGateService(canaryRepository({ currentWatermark: 101 })).applyRequest(fakeConnection(), {
        requestId: CANARY_REQUEST_ID,
        actorUserId: 5,
      }),
    ).rejects.toMatchObject({ code: "OBSERVATION_WATERMARK_STALE" });
  });

  it("promotes only after one complete shadow batch covers every current source watermark", async () => {
    await expect(
      new IdentityTransitionGateService(canaryRepository()).applyRequest(fakeConnection(), {
        requestId: CANARY_REQUEST_ID,
        actorUserId: 5,
      }),
    ).resolves.toEqual({ writeMode: "DUAL", readMode: "CANARY", phase: "CANARY", version: 5 });
  });
});

const CANARY_REQUEST_ID = "20000000-0000-4000-8000-000000000002";

function canaryRepository(
  overrides: {
    observations?: IdentityObservationAggregateRow[];
    observedWatermarks?: IdentityObservationWatermarkRow[];
    currentWatermark?: number;
    invariants?: ReturnType<typeof zeroInvariantAggregates>;
    rangeSnapshot?: IdentityRangeValidationSnapshot;
  } = {},
): IdentityTransitionGateRepository {
  return {
    loadState: vi.fn(async () => state({ writeMode: "DUAL", readMode: "SHADOW", phase: "SHADOWING", version: 4 })),
    loadRequest: vi.fn(async () => ({
      id: CANARY_REQUEST_ID,
      targetStage: "CANARY",
      status: "PENDING",
      expectedStateVersion: 4,
      reasonCode: "PROMOTE:CANARY",
      minimumComparedEntityCount: 10,
      minimumObservationMinutes: 30,
      maximumRollbackMinutes: 15,
      requestedBy: 1,
    })),
    loadApprovals: vi.fn(async () => [
      { approvalType: "OPERATIONS", approvedBy: 2 },
      { approvalType: "DATA_OWNER", approvedBy: 3 },
      { approvalType: "PRIVACY", approvedBy: 4 },
    ]),
    loadRequestEvidence: vi.fn(async () => [
      evidenceRow("BACKUP_RESTORE", 1),
      evidenceRow("ROLLBACK_REHEARSAL", 2, 5),
      evidenceRow("TARGET_READ_CONTRACT_READY", 3),
      evidenceRow("TARGET_WRITE_CONTRACT_READY", 4),
    ]),
    loadBackfillRun: vi.fn(async () => ({ status: "SUCCEEDED", completedAt: new Date("2026-08-27T00:00:00Z") })),
    countOpenIssues: vi.fn(async () => 0),
    loadRelationshipInvariantAggregates: vi.fn(async () => overrides.invariants ?? zeroInvariantAggregates()),
    loadRangeValidationSnapshot: vi.fn(
      async () => overrides.rangeSnapshot ?? { admissions: [], slots: [], segments: [] },
    ),
    countCanaryTargets: vi.fn(async () => 1),
    loadLatestPhaseEntry: vi.fn(async () => new Date("2026-08-27T00:00:00Z")),
    loadObservationAggregates: vi.fn(async () => overrides.observations ?? qualifyingObservations()),
    loadLatestCompletedObservationWatermarks: vi.fn(async () => overrides.observedWatermarks ?? qualifyingWatermarks()),
    loadCurrentSourceMutationHighWaterMark: vi.fn(async () => overrides.currentWatermark ?? 100),
    updateState: vi.fn(async () => true),
    insertHistory: vi.fn(async () => 1),
    linkHistoryEvidence: vi.fn(async () => undefined),
    markRequestApplied: vi.fn(async () => true),
  } as unknown as IdentityTransitionGateRepository;
}

function qualifyingWatermarks(): IdentityObservationWatermarkRow[] {
  return IDENTITY_SHADOW_OBSERVATION_TYPES.map(
    (observationType) => ({ observationType, sourceHighWaterMark: 100 }) as IdentityObservationWatermarkRow,
  );
}

function evidenceRow(type: string, suffix: number, elapsedMinutes: number | null = null) {
  return {
    evidenceId: `50000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`,
    evidenceType: type,
    elapsedMinutes,
  };
}

function zeroInvariantAggregates() {
  return identityRelationshipInvariantCodes.map((invariantCode) => ({ invariantCode, violationCount: 0 }));
}

function qualifyingObservations(): IdentityObservationAggregateRow[] {
  return IDENTITY_SHADOW_OBSERVATION_TYPES.map(
    (observationType) =>
      ({
        observationType,
        observationCount: 2,
        comparedEntityCount: 20,
        mismatchCount: 0,
        oldOnlyCount: 0,
        newOnlyCount: 0,
        ambiguousCount: 0,
        firstObservedAt: new Date("2026-08-27T00:00:00Z"),
        lastObservedAt: new Date("2026-08-27T01:00:00Z"),
      }) as IdentityObservationAggregateRow,
  );
}

function fakeConnection(
  overrides: {
    state?: ReturnType<typeof state>;
    request?: Record<string, unknown>;
  } = {},
) {
  const selectedState = overrides.state ?? state();
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM identity_transition_state")) return [[selectedState], []];
    return [[], []];
  });
  const execute = vi.fn(async (sql: string) => {
    if (sql.includes("FROM identity_transition_request WHERE")) {
      return [overrides.request ? [overrides.request] : [], []];
    }
    return [{ affectedRows: 1, insertId: 1 } as ResultSetHeader, []];
  });
  return {
    query,
    execute,
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
  } as unknown as Pick<Connection, "query" | "execute" | "beginTransaction" | "commit" | "rollback"> & {
    query: typeof query;
    execute: typeof execute;
    beginTransaction: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
  };
}

function state(
  overrides: Partial<{
    writeMode: "LEGACY" | "DUAL" | "CANONICAL";
    readMode: "LEGACY" | "SHADOW" | "CANARY" | "CANONICAL";
    phase: "EXPANDED" | "BACKFILLED" | "SHADOWING" | "CANARY" | "CANONICAL";
    version: number;
  }> = {},
) {
  return {
    writeMode: "LEGACY" as const,
    readMode: "LEGACY" as const,
    phase: "BACKFILLED" as const,
    version: 1,
    lastBackfillRunId: "30000000-0000-4000-8000-000000000001",
    ...overrides,
  };
}
