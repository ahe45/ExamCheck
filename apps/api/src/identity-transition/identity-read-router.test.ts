import { describe, expect, it, vi } from "vitest";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { IdentityReadRouter, resolveFailClosedAdmissionAccess } from "./identity-read-router.js";
import type { IdentityShadowObservationRepository } from "./identity-shadow-observation.repository.js";
import type {
  IdentityReadMode,
  IdentityTransitionRuntimeState,
  IdentityTransitionStateRepository,
} from "./identity-transition-state.js";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("identity transition read router", () => {
  it.each([
    ["LEGACY", false, "LEGACY", 1, 0, 0],
    ["SHADOW", false, "LEGACY", 1, 1, 1],
    ["CANARY", false, "LEGACY", 1, 1, 1],
    ["CANARY", true, "TARGET", 1, 1, 1],
    ["CANONICAL", false, "TARGET", 0, 1, 0],
  ] as const)(
    "%s selected=%s responds from %s and uses the expected projections",
    async (readMode, canarySelected, source, legacyCalls, targetCalls, observationCalls) => {
      const { router, record, isCanarySelected } = fixture(readMode, canarySelected);
      const legacy = vi.fn(async () => ({
        value: "legacy-value",
        rows: [{ entityId: 1, projection: { status: "same" } }],
      }));
      const target = vi.fn(async () => ({
        value: "target-value",
        rows: [{ entityId: 1, projection: { status: "same" } }],
      }));

      const result = await router.route(executor(), {
        userId: 7,
        admissionId: 11,
        observationType: "candidate.list",
        sourceHighWaterMark: 99,
        legacy,
        target,
      });

      expect(result.decision.responseSource).toBe(source);
      expect(result.value).toBe(source === "LEGACY" ? "legacy-value" : "target-value");
      expect(legacy).toHaveBeenCalledTimes(legacyCalls);
      expect(target).toHaveBeenCalledTimes(targetCalls);
      expect(record).toHaveBeenCalledTimes(observationCalls);
      expect(isCanarySelected).toHaveBeenCalledTimes(readMode === "CANARY" ? 1 : 0);
    },
  );

  it("stores only the HMAC comparison report during shadow routing", async () => {
    const { router, record, loadSourceMutationHighWaterMark } = fixture("SHADOW", false);
    const privateValue = "PRIVATE-CANDIDATE-009";

    const result = await router.route(executor(), {
      userId: 7,
      observationType: "candidate.detail",
      legacy: async () => ({ value: "legacy", rows: [{ entityId: 9, projection: { name: privateValue } }] }),
      target: async () => ({ value: "target", rows: [{ entityId: 9, projection: { name: "different" } }] }),
    });

    expect(result.comparison?.counts.mismatch).toBe(1);
    const observation = record.mock.calls[0]?.[1];
    expect(JSON.stringify(observation)).not.toContain(privateValue);
    expect(observation).toMatchObject({ observationType: "candidate.detail", sourceHighWaterMark: 23 });
    expect(loadSourceMutationHighWaterMark).toHaveBeenCalledOnce();
  });

  it("uses a caller-provided high-water mark without loading it again", async () => {
    const { router, record, loadSourceMutationHighWaterMark } = fixture("SHADOW", false);

    await router.route(executor(), {
      userId: 7,
      observationType: "candidate.detail",
      sourceHighWaterMark: 99,
      legacy: async () => ({ value: "legacy", rows: [{ entityId: 9, projection: { status: "same" } }] }),
      target: async () => ({ value: "target", rows: [{ entityId: 9, projection: { status: "same" } }] }),
    });

    expect(record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sourceHighWaterMark: 99 }));
    expect(loadSourceMutationHighWaterMark).not.toHaveBeenCalled();
  });

  it("fails closed to the intersection when legacy and target authorization disagree", () => {
    expect(resolveFailClosedAdmissionAccess([5, 2, 2, 7], [2, 5, 9])).toEqual({
      allowedAdmissionIds: [2, 5],
      matches: false,
      legacyOnlyCount: 1,
      targetOnlyCount: 1,
    });
    expect(resolveFailClosedAdmissionAccess([2, 5], [5, 2])).toMatchObject({ matches: true });
  });

  it("rejects invalid authorization IDs instead of broadening scope", () => {
    expect(() => resolveFailClosedAdmissionAccess([1], [0])).toThrow("positive safe integer");
  });
});

function fixture(
  readMode: IdentityReadMode,
  selected: boolean,
): {
  router: IdentityReadRouter;
  record: ReturnType<typeof vi.fn>;
  isCanarySelected: ReturnType<typeof vi.fn>;
  loadSourceMutationHighWaterMark: ReturnType<typeof vi.fn>;
} {
  const state = runtimeState(readMode);
  const isCanarySelected = vi.fn(async () => selected);
  const stateRepository = {
    loadForRead: vi.fn(async () => state),
    isCanarySelected,
  } as unknown as IdentityTransitionStateRepository;
  const record = vi.fn(async () => undefined);
  const loadSourceMutationHighWaterMark = vi.fn(async () => 23);
  const observationRepository = {
    record,
    loadSourceMutationHighWaterMark,
  } as unknown as IdentityShadowObservationRepository;
  return {
    router: new IdentityReadRouter(stateRepository, observationRepository),
    record,
    isCanarySelected,
    loadSourceMutationHighWaterMark,
  };
}

function runtimeState(readMode: IdentityReadMode): IdentityTransitionRuntimeState {
  return {
    enabled: true,
    writeMode: readMode === "CANONICAL" ? "CANONICAL" : "DUAL",
    readMode,
    phase: readMode === "CANONICAL" ? "CANONICAL" : readMode === "CANARY" ? "CANARY" : "SHADOWING",
    version: 3,
    shadowHmacSecret: readMode === "SHADOW" || readMode === "CANARY" ? SECRET : null,
  };
}

function executor(): SqlExecutor {
  return { execute: vi.fn(), query: vi.fn() } as unknown as SqlExecutor;
}
