import { describe, expect, it } from "vitest";
import { assertIsolatedShadowExecution } from "../identity-transition/identity-shadow-verifier.js";
import { parseIdentityShadowVerifyCliOptions } from "./identity-shadow-verify-cli.js";

describe("identity shadow verification CLI safety boundary", () => {
  it("only accepts the explicit isolated-copy confirmation", () => {
    expect(parseIdentityShadowVerifyCliOptions(["--confirm-isolated-copy"])).toEqual({
      confirmIsolatedCopy: true,
    });
    expect(() => parseIdentityShadowVerifyCliOptions(["--database=production"])).toThrow("Unknown");
  });

  it("requires confirmation and a visibly isolated database name", () => {
    expect(() => assertIsolatedShadowExecution("examcheck_test_restore", false)).toThrow("confirm-isolated-copy");
    expect(() => assertIsolatedShadowExecution("examcheck", true)).toThrow("isolated database copy");
    expect(() => assertIsolatedShadowExecution("examcheck_it_1234", true)).not.toThrow();
    expect(() => assertIsolatedShadowExecution("examcheck_shadow_copy", true)).not.toThrow();
  });
});
