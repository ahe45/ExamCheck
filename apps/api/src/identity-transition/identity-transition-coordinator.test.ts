import { describe, expect, it, vi } from "vitest";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { IdentityTransitionCoordinator } from "./identity-transition-coordinator.js";
import type {
  IdentityTransitionRuntimeState,
  IdentityTransitionStateRepository,
  IdentityWriteMode,
} from "./identity-transition-state.js";

describe("identity transition write coordinator", () => {
  it.each([
    ["LEGACY", true, false, "LEGACY"],
    ["DUAL", true, true, "LEGACY"],
    ["CANONICAL", false, true, "TARGET"],
  ] as const)("makes the %s destinations and authority explicit", async (mode, legacy, target, authority) => {
    const { coordinator } = fixture(mode);

    await expect(coordinator.decideWrite(executor())).resolves.toMatchObject({
      writeLegacy: legacy,
      writeTarget: target,
      authority,
    });
  });

  it("writes legacy before target in DUAL mode and passes the generated result forward", async () => {
    const { coordinator } = fixture("DUAL");
    const order: string[] = [];
    const legacy = vi.fn(async () => {
      order.push("legacy");
      return { legacyId: 73 };
    });
    const target = vi.fn(async ({ legacyResult }: { legacyResult: { legacyId: number } | undefined }) => {
      order.push("target");
      return { bridgeId: legacyResult?.legacyId };
    });

    const result = await coordinator.executeWrite(executor(), { legacy, target });

    expect(order).toEqual(["legacy", "target"]);
    expect(target).toHaveBeenCalledWith(expect.objectContaining({ legacyResult: { legacyId: 73 } }));
    expect(result).toMatchObject({ legacyResult: { legacyId: 73 }, targetResult: { bridgeId: 73 } });
  });

  it("validates all required writers before making the first write", async () => {
    const { coordinator } = fixture("DUAL");
    const legacy = vi.fn(async () => 1);

    await expect(coordinator.executeWrite(executor(), { legacy })).rejects.toThrow("target writer");
    expect(legacy).not.toHaveBeenCalled();
  });

  it("requires the legacy writer in LEGACY mode", async () => {
    const { coordinator } = fixture("LEGACY");

    await expect(coordinator.executeWrite(executor(), {})).rejects.toThrow("legacy writer");
  });

  it("executes only the target writer in CANONICAL mode", async () => {
    const { coordinator } = fixture("CANONICAL");
    const target = vi.fn(async ({ legacyResult }) => legacyResult ?? "target-only");

    await expect(coordinator.executeWrite(executor(), { target })).resolves.toMatchObject({
      legacyResult: undefined,
      targetResult: "target-only",
    });
  });

  it("rejects a state that selects no write destination", async () => {
    const stateRepository = {
      lockForMutation: vi.fn(async () => runtimeState("LEGACY")),
      shouldWriteLegacy: vi.fn(() => false),
      shouldWriteTarget: vi.fn(() => false),
    } as unknown as IdentityTransitionStateRepository;
    const coordinator = new IdentityTransitionCoordinator(stateRepository);

    await expect(coordinator.decideWrite(executor())).rejects.toThrow("does not select a write destination");
  });
});

function fixture(writeMode: IdentityWriteMode): { coordinator: IdentityTransitionCoordinator } {
  const state = runtimeState(writeMode);
  const stateRepository = {
    lockForMutation: vi.fn(async () => state),
    shouldWriteLegacy: vi.fn(
      (selected: IdentityTransitionRuntimeState) => selected.writeMode === "LEGACY" || selected.writeMode === "DUAL",
    ),
    shouldWriteTarget: vi.fn(
      (selected: IdentityTransitionRuntimeState) => selected.writeMode === "DUAL" || selected.writeMode === "CANONICAL",
    ),
  } as unknown as IdentityTransitionStateRepository;
  return { coordinator: new IdentityTransitionCoordinator(stateRepository) };
}

function runtimeState(writeMode: IdentityWriteMode): IdentityTransitionRuntimeState {
  return {
    enabled: true,
    writeMode,
    readMode: "LEGACY",
    phase: writeMode === "CANONICAL" ? "CANONICAL" : "EXPANDED",
    version: 2,
    shadowHmacSecret: null,
  };
}

function executor(): SqlExecutor {
  return { execute: vi.fn(), query: vi.fn() } as unknown as SqlExecutor;
}
