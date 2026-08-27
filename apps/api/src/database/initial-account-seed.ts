import { INITIAL_ACCOUNT_LOGIN_IDS, type InitialAccountSeed } from "../config/security-config.js";

export interface InitialAccountInsert {
  sql: string;
  values: [string, InitialAccountSeed["role"], string];
}

export function buildInitialAccountInsert(
  seed: Pick<InitialAccountSeed, "loginId" | "role">,
  passwordHash: string,
): InitialAccountInsert {
  return {
    sql: `INSERT IGNORE INTO app_user (login_id, role, password_hash)
          VALUES (?, ?, ?)`,
    values: [seed.loginId, seed.role, passwordHash],
  };
}

export function missingInitialAccountLoginIds(existingLoginIds: Iterable<string>) {
  const existing = new Set(existingLoginIds);
  return INITIAL_ACCOUNT_LOGIN_IDS.filter((loginId) => !existing.has(loginId));
}
