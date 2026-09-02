import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/app-config.js";
import { type IdentityTransitionRuntimeState, IdentityTransitionStateRepository } from "./identity-transition-state.js";

describe("identity transition state", () => {
  it("forces legacy behavior without querying the database when the master switch is off", async () => {
    const repository = new IdentityTransitionStateRepository(config(false));
    const executor = { query: vi.fn(), execute: vi.fn() };

    const state = await repository.lockForMutation(executor as never);

    expect(state).toMatchObject({ enabled: false, writeMode: "LEGACY", readMode: "LEGACY" });
    expect(executor.query).not.toHaveBeenCalled();
    expect(repository.shouldWriteLegacy(state)).toBe(true);
    expect(repository.shouldWriteTarget(state)).toBe(false);
  });

  it("loads one shared transaction state and enables target writes in DUAL mode", async () => {
    const repository = new IdentityTransitionStateRepository(config(true));
    const executor = {
      query: vi
        .fn()
        .mockResolvedValue([[{ writeMode: "DUAL", readMode: "SHADOW", phase: "SHADOWING", version: 3 }], []]),
      execute: vi.fn(),
    };

    const state = await repository.lockForMutation(executor as never);

    expect(executor.query).toHaveBeenCalledWith(expect.stringContaining("LOCK IN SHARE MODE"));
    expect(repository.shouldWriteLegacy(state)).toBe(true);
    expect(repository.shouldWriteTarget(state)).toBe(true);
    expect(repository.requiresShadowComparison(state)).toBe(true);
  });

  it("covers every write and shadow routing predicate", () => {
    const repository = new IdentityTransitionStateRepository(config(true));
    const legacy = state({ writeMode: "LEGACY", readMode: "LEGACY", phase: "EXPANDED" });
    const canonical = state({ writeMode: "CANONICAL", readMode: "CANONICAL", phase: "CANONICAL" });
    const canary = state({ writeMode: "DUAL", readMode: "CANARY", phase: "CANARY" });

    expect(repository.shouldWriteLegacy(legacy)).toBe(true);
    expect(repository.shouldWriteTarget(legacy)).toBe(false);
    expect(repository.requiresShadowComparison(legacy)).toBe(false);
    expect(repository.shouldWriteLegacy(canonical)).toBe(false);
    expect(repository.shouldWriteTarget(canonical)).toBe(true);
    expect(repository.requiresShadowComparison(canary)).toBe(true);
  });

  it.each([
    [1, undefined, true],
    [0, 17, false],
    [undefined, undefined, false],
  ] as const)("maps canary selection %s for admission %s", async (selected, admissionId, expected) => {
    const repository = new IdentityTransitionStateRepository(config(true));
    const executor = { query: vi.fn(), execute: vi.fn().mockResolvedValue([[{ selected }], []]) };

    await expect(repository.isCanarySelected(executor as never, 9, admissionId)).resolves.toBe(expected);
    expect(executor.execute).toHaveBeenCalledWith(expect.stringContaining("identity_canary_user"), [
      9,
      admissionId ?? null,
      admissionId ?? null,
    ]);
  });

  it("rejects a missing transition row and shadow reads without an HMAC secret", async () => {
    const missing = new IdentityTransitionStateRepository(config(true));
    await expect(missing.loadForRead({ query: vi.fn().mockResolvedValue([[], []]) } as never)).rejects.toThrow(
      "state is missing",
    );

    const shadow = new IdentityTransitionStateRepository(config(true, null));
    const executor = {
      query: vi
        .fn()
        .mockResolvedValue([[{ writeMode: "DUAL", readMode: "SHADOW", phase: "SHADOWING", version: 4 }], []]),
    };
    await expect(shadow.loadForRead(executor as never)).rejects.toThrow("IDENTITY_SHADOW_HMAC_SECRET");
    expect(executor.query).toHaveBeenCalledWith(expect.not.stringContaining("LOCK IN SHARE MODE"));
  });

  it.each([
    [{ writeMode: "CANONICAL", readMode: "LEGACY", phase: "BACKFILLED" }, "CANONICAL transition phase"],
    [{ writeMode: "DUAL", readMode: "CANONICAL", phase: "CANARY" }, "Canonical identity reads"],
    [{ writeMode: "DUAL", readMode: "CANARY", phase: "SHADOWING" }, "Canary identity reads"],
    [{ writeMode: "DUAL", readMode: "LEGACY", phase: "BLOCKED" }, "Blocked identity transitions"],
    [{ writeMode: "LEGACY", readMode: "SHADOW", phase: "BLOCKED" }, "Blocked identity transitions"],
  ] as const)("rejects unsafe transition combination %#", async (row, message) => {
    const repository = new IdentityTransitionStateRepository(config(true));
    const executor = {
      query: vi.fn().mockResolvedValue([[{ ...row, version: 1 }], []]),
      execute: vi.fn(),
    };
    await expect(repository.loadForRead(executor as never)).rejects.toThrow(message);
  });
});

function config(
  enabled: boolean,
  shadowHmacSecret: string | null = "0123456789abcdef0123456789abcdef",
): Readonly<AppConfig> {
  return {
    identityTransition: {
      enabled,
      shadowHmacSecret: enabled ? shadowHmacSecret : null,
    },
  } as Readonly<AppConfig>;
}

function state(
  overrides: Pick<IdentityTransitionRuntimeState, "writeMode" | "readMode" | "phase">,
): IdentityTransitionRuntimeState {
  return {
    enabled: true,
    version: 1,
    shadowHmacSecret: null,
    ...overrides,
  };
}
