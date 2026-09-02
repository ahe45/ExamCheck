import { Inject, Injectable } from "@nestjs/common";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { IdentityTransitionStateRepository, type IdentityTransitionRuntimeState } from "./identity-transition-state.js";

export type IdentityWriteAuthority = "LEGACY" | "TARGET";

export interface IdentityWriteDecision {
  state: IdentityTransitionRuntimeState;
  writeLegacy: boolean;
  writeTarget: boolean;
  authority: IdentityWriteAuthority;
}

export interface IdentityWriteHandlers<TLegacy, TTarget> {
  legacy?: () => Promise<TLegacy>;
  target?: (context: { decision: IdentityWriteDecision; legacyResult: TLegacy | undefined }) => Promise<TTarget>;
}

export interface IdentityWriteResult<TLegacy, TTarget> {
  decision: IdentityWriteDecision;
  legacyResult: TLegacy | undefined;
  targetResult: TTarget | undefined;
}

@Injectable()
export class IdentityTransitionCoordinator {
  constructor(
    @Inject(IdentityTransitionStateRepository)
    private readonly stateRepository: IdentityTransitionStateRepository,
  ) {}

  async decideWrite(executor: SqlExecutor): Promise<IdentityWriteDecision> {
    const state = await this.stateRepository.lockForMutation(executor);
    const writeLegacy = this.stateRepository.shouldWriteLegacy(state);
    const writeTarget = this.stateRepository.shouldWriteTarget(state);
    if (!writeLegacy && !writeTarget) {
      throw new Error("Identity transition state does not select a write destination.");
    }
    return {
      state,
      writeLegacy,
      writeTarget,
      authority: writeTarget && !writeLegacy ? "TARGET" : "LEGACY",
    };
  }

  /**
   * Executes inside the caller-owned transaction. DUAL always writes legacy first so
   * generated legacy IDs can be used to create target bridge rows atomically.
   */
  async executeWrite<TLegacy, TTarget>(
    executor: SqlExecutor,
    handlers: IdentityWriteHandlers<TLegacy, TTarget>,
  ): Promise<IdentityWriteResult<TLegacy, TTarget>> {
    const decision = await this.decideWrite(executor);
    assertRequiredHandlers(decision, handlers);

    let legacyResult: TLegacy | undefined;
    let targetResult: TTarget | undefined;
    if (decision.writeLegacy) legacyResult = await handlers.legacy!();
    if (decision.writeTarget) targetResult = await handlers.target!({ decision, legacyResult });
    return { decision, legacyResult, targetResult };
  }
}

function assertRequiredHandlers<TLegacy, TTarget>(
  decision: IdentityWriteDecision,
  handlers: IdentityWriteHandlers<TLegacy, TTarget>,
): void {
  if (decision.writeLegacy && !handlers.legacy) {
    throw new TypeError("The selected identity write mode requires a legacy writer.");
  }
  if (decision.writeTarget && !handlers.target) {
    throw new TypeError("The selected identity write mode requires a target writer.");
  }
}
