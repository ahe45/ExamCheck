import { describe, expect, it } from "vitest";
import {
  getMySqlErrorCode,
  isConcurrentWriteError,
  isDuplicateEntryError,
  isMySqlErrorCode,
  MYSQL_DUPLICATE_ENTRY,
  MYSQL_LOCK_DEADLOCK,
  MYSQL_LOCK_WAIT_TIMEOUT,
} from "./mysql-errors.js";

describe("MySQL error classification", () => {
  it.each([null, undefined, "ER_DUP_ENTRY", 1062, {}, { code: 1062 }])(
    "does not classify malformed error values: %j",
    (error) => {
      expect(getMySqlErrorCode(error)).toBeNull();
      expect(isDuplicateEntryError(error)).toBe(false);
      expect(isConcurrentWriteError(error)).toBe(false);
    },
  );

  it("classifies duplicate key failures consistently", () => {
    const error = Object.assign(new Error("duplicate"), { code: MYSQL_DUPLICATE_ENTRY });

    expect(getMySqlErrorCode(error)).toBe(MYSQL_DUPLICATE_ENTRY);
    expect(isDuplicateEntryError(error)).toBe(true);
    expect(isConcurrentWriteError(error)).toBe(true);
    expect(isMySqlErrorCode(error, MYSQL_LOCK_DEADLOCK)).toBe(false);
  });

  it.each([MYSQL_LOCK_DEADLOCK, MYSQL_LOCK_WAIT_TIMEOUT])("classifies retryable lock failure %s", (code) => {
    const error = { code };

    expect(isDuplicateEntryError(error)).toBe(false);
    expect(isConcurrentWriteError(error)).toBe(true);
  });
});
