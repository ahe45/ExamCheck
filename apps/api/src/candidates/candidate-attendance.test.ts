import { describe, expect, it } from "vitest";
import { candidateAttendance } from "./candidate-attendance.js";

describe("candidateAttendance", () => {
  it.each([
    [{ absent: 1, processed: 1, closed: 0 }, "결시"],
    [{ absent: 1, processed: 0, closed: 1 }, "결시"],
    [{ absent: 0, processed: 1, closed: 0 }, "응시"],
    [{ absent: 0, processed: 1, closed: 1 }, "응시"],
    [{ absent: 0, processed: 0, closed: 0 }, "대기"],
    [{ absent: 0, processed: 0, closed: 1 }, "결시"],
  ] as const)("resolves %j to %s", (state, expected) => {
    expect(candidateAttendance(state)).toBe(expected);
  });
});
