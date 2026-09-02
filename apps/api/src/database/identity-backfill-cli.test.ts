import { describe, expect, it } from "vitest";
import { assertIsolatedExecution, parseCliOptions } from "./identity-backfill-cli.js";
import { assertIsolatedBackfillExecution } from "./identity-backfill.js";

describe("identity backfill CLI safety boundary", () => {
  it("parses an explicitly confirmed isolated run", () => {
    expect(
      parseCliOptions(["--confirm-isolated-copy", "--exam-name=  ２０２６ 전형  ", "--chunk-size=25"], ""),
    ).toEqual({ confirmIsolatedCopy: true, examName: "2026 전형", chunkSize: 25 });
  });

  it("rejects unknown options", () => {
    expect(() => parseCliOptions(["--execute-operational"], "시험")).toThrow(/Unknown/);
  });

  it("requires both confirmation and an isolated database name", () => {
    expect(() => assertIsolatedExecution("examcheck_test_restore", false)).toThrow(/confirm-isolated-copy/);
    expect(() => assertIsolatedExecution("examcheck", true)).toThrow(/isolated database copy/);
    expect(() => assertIsolatedExecution("examcheck_test_restore", true)).not.toThrow();
    expect(() => assertIsolatedBackfillExecution("examcheck_test_restore", false)).toThrow(/explicitly confirmed/);
    expect(() => assertIsolatedBackfillExecution("examcheck", true)).toThrow(/isolated database copy/);
    expect(() => assertIsolatedBackfillExecution("examcheck_test_restore", true)).not.toThrow();
  });
});
