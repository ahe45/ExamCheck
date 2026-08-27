import { describe, expect, it } from "vitest";
import { assignmentMethodToOperationMode } from "./useOperationSettings";

describe("operation settings mapping", () => {
  it.each([
    ["DRAW", "RANDOM"],
    ["SEQUENTIAL", "SEQUENTIAL"],
    ["MATCHING", "MANUAL"],
    ["PREASSIGNED", "PREASSIGNED"],
  ] as const)("%s 설정을 %s 운영 모드로 변환한다", (method, expected) => {
    expect(assignmentMethodToOperationMode(method)).toBe(expected);
  });
});
