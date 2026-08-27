import type { Connection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { hashPassword } from "../auth/password.js";
import {
  INITIAL_ACCOUNT_LOGIN_IDS,
  resolveInitialAccountSeeds,
  type SecurityEnvironment,
} from "../config/security-config.js";
import { buildInitialAccountInsert, missingInitialAccountLoginIds } from "./initial-account-seed.js";

export type InitialAccountBootstrapConnection = Pick<
  Connection,
  "execute" | "beginTransaction" | "commit" | "rollback"
>;

export interface InitialAccountBootstrapResult {
  existingLoginIds: string[];
  createdLoginIds: string[];
}

interface ExistingInitialAccountRow extends RowDataPacket {
  loginId: string;
}

export async function bootstrapInitialAccounts(
  connection: InitialAccountBootstrapConnection,
  environment: SecurityEnvironment,
  passwordHasher: (password: string) => string | Promise<string> = hashPassword,
): Promise<InitialAccountBootstrapResult> {
  await connection.beginTransaction();
  try {
    const placeholders = INITIAL_ACCOUNT_LOGIN_IDS.map(() => "?").join(", ");
    const [existingInitialAccounts] = await connection.execute<ExistingInitialAccountRow[]>(
      `SELECT login_id AS loginId FROM app_user
       WHERE login_id IN (${placeholders})
       ORDER BY login_id
       FOR UPDATE`,
      [...INITIAL_ACCOUNT_LOGIN_IDS],
    );
    const existingLoginIds = existingInitialAccounts.map((account) => account.loginId);
    const missingLoginIds = missingInitialAccountLoginIds(existingLoginIds);
    const statements = [];
    for (const account of resolveInitialAccountSeeds(environment, missingLoginIds)) {
      statements.push({
        loginId: account.loginId,
        statement: buildInitialAccountInsert(account, await passwordHasher(account.password)),
      });
    }

    const createdLoginIds: string[] = [];
    for (const { loginId, statement } of statements) {
      const [result] = await connection.execute<ResultSetHeader>(statement.sql, statement.values);
      if (result.affectedRows > 0) createdLoginIds.push(loginId);
    }

    await connection.commit();
    return { existingLoginIds, createdLoginIds };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}
