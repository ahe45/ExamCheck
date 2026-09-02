import { describe, expect, it } from "vitest";
import { assertIsolatedTransitionExecution, parseIdentityTransitionCliOptions } from "./identity-transition-cli.js";

describe("identity transition CLI safety boundary", () => {
  it("accepts only an explicitly confirmed isolated database copy", () => {
    expect(() => assertIsolatedTransitionExecution("examcheck_it_restore", false)).toThrow(/confirm-isolated-copy/);
    expect(() => assertIsolatedTransitionExecution("examcheck", true)).toThrow(/intentionally unavailable/);
    expect(() => assertIsolatedTransitionExecution("examcheck_staging_restore", true)).not.toThrow();
  });

  it("parses explicit request thresholds without defaults", () => {
    expect(
      parseIdentityTransitionCliOptions([
        "request",
        "--confirm-isolated-copy",
        "--target=CANARY",
        "--expected-version=7",
        "--reason=PROMOTE:CANARY",
        "--min-compared-entities=100",
        "--min-observation-minutes=60",
        "--max-rollback-minutes=15",
        "--requested-by=3",
      ]),
    ).toEqual({
      command: "request",
      confirmIsolatedCopy: true,
      input: {
        targetStage: "CANARY",
        expectedStateVersion: 7,
        reasonCode: "PROMOTE:CANARY",
        minimumComparedEntityCount: 100,
        minimumObservationMinutes: 60,
        maximumRollbackMinutes: 15,
        requestedBy: 3,
      },
    });
  });

  it("keeps canonical promotion manual and rejects operational shortcuts", () => {
    const requestId = "40000000-0000-4000-8000-000000000001";
    expect(
      parseIdentityTransitionCliOptions([
        "apply",
        "--confirm-isolated-copy",
        `--request=${requestId}`,
        "--actor=7",
        "--confirm-canonical-manual",
      ]),
    ).toEqual({
      command: "apply",
      confirmIsolatedCopy: true,
      input: { requestId, actorUserId: 7, manualCanonicalConfirmation: true },
    });
    expect(() =>
      parseIdentityTransitionCliOptions([
        "apply",
        "--confirm-isolated-copy",
        `--request=${requestId}`,
        "--actor=7",
        "--execute-operational",
      ]),
    ).toThrow(/unknown or duplicate/);
  });

  it("parses structured evidence without free-form details", () => {
    expect(
      parseIdentityTransitionCliOptions([
        "record-evidence",
        "--confirm-isolated-copy",
        "--type=ROLLBACK_REHEARSAL",
        "--result=PASSED",
        "--reference=CHANGE:ROLLBACK-1",
        "--elapsed-minutes=9",
        "--observed-at=2026-08-28T00:00:00.000Z",
        "--valid-until=2026-08-29T00:00:00.000Z",
        "--recorded-by=1",
        "--verified-by=2",
      ]),
    ).toEqual({
      command: "record-evidence",
      confirmIsolatedCopy: true,
      input: {
        evidenceType: "ROLLBACK_REHEARSAL",
        result: "PASSED",
        referenceCode: "CHANGE:ROLLBACK-1",
        elapsedMinutes: 9,
        observedAt: new Date("2026-08-28T00:00:00.000Z"),
        validUntil: new Date("2026-08-29T00:00:00.000Z"),
        recordedBy: 1,
        verifiedBy: 2,
      },
    });
  });

  it("keeps emergency LEGACY rollback available with actor and reason only", () => {
    expect(
      parseIdentityTransitionCliOptions([
        "rollback",
        "--confirm-isolated-copy",
        "--to=LEGACY",
        "--actor=7",
        "--reason=INCIDENT:FAILSAFE",
      ]),
    ).toEqual({
      command: "rollback",
      confirmIsolatedCopy: true,
      input: { target: "LEGACY", actorUserId: 7, reasonCode: "INCIDENT:FAILSAFE" },
    });
  });
});
