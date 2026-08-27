export const MYSQL_DUPLICATE_ENTRY = "ER_DUP_ENTRY";
export const MYSQL_LOCK_DEADLOCK = "ER_LOCK_DEADLOCK";
export const MYSQL_LOCK_WAIT_TIMEOUT = "ER_LOCK_WAIT_TIMEOUT";

export type MySqlErrorCode = typeof MYSQL_DUPLICATE_ENTRY | typeof MYSQL_LOCK_DEADLOCK | typeof MYSQL_LOCK_WAIT_TIMEOUT;

export function getMySqlErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

export function isMySqlErrorCode(error: unknown, ...codes: readonly MySqlErrorCode[]): boolean {
  const code = getMySqlErrorCode(error);
  return code !== null && codes.includes(code as MySqlErrorCode);
}

export function isDuplicateEntryError(error: unknown): boolean {
  return isMySqlErrorCode(error, MYSQL_DUPLICATE_ENTRY);
}

export function isConcurrentWriteError(error: unknown): boolean {
  return isMySqlErrorCode(error, MYSQL_DUPLICATE_ENTRY, MYSQL_LOCK_DEADLOCK, MYSQL_LOCK_WAIT_TIMEOUT);
}
