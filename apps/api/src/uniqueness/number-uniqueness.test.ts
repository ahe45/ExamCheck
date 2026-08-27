import { describe, expect, it } from "vitest";
import { pseudonymUniquenessScopeKey } from "./number-uniqueness.js";

describe("pseudonym uniqueness scope key", () => {
  const scope = { date: "2026-09-01", time: "09:00", period: "1교시", admission: "일반전형" };

  it("uses one empty key for an admission-wide policy", () => {
    expect(pseudonymUniquenessScopeKey("ADMISSION", scope)).toBe("");
  });

  it("uses a stable schedule key and changes it when the period changes", () => {
    const key = pseudonymUniquenessScopeKey("SCHEDULE", scope);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(pseudonymUniquenessScopeKey("SCHEDULE", scope)).toBe(key);
    expect(pseudonymUniquenessScopeKey("SCHEDULE", { ...scope, period: "2교시" })).not.toBe(key);
  });
});
