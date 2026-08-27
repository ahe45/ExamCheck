import { Injectable } from "@nestjs/common";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { UserRole } from "../auth/auth.types.js";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { toManagedAccountRole, type StoredManagedAccountRole } from "./accounts.domain.js";

interface AccountRow extends RowDataPacket {
  id: number;
  loginId: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date | null;
}

interface AdmissionRow extends RowDataPacket {
  admissionName: string;
}

interface AssignmentRow extends AdmissionRow {
  userId: number;
}

interface IdRow extends RowDataPacket {
  id: number;
}

export interface AccountTarget {
  id: number;
  role: UserRole;
}

interface AccountTargetRow extends IdRow {
  role: UserRole;
}

export interface ManagedAccountView {
  id: number;
  loginId: string;
  role: "ADMIN" | "USER";
  createdAt: Date;
  updatedAt: Date | null;
  admissionNames: string[];
}

export interface AccountUpdateValues {
  loginId: string;
  role: StoredManagedAccountRole;
  passwordHash?: string;
  invalidateSessions: boolean;
}

@Injectable()
export class AccountsRepository {
  async list(executor: SqlExecutor): Promise<ManagedAccountView[]> {
    const [accounts] = await executor.query<AccountRow[]>(
      `SELECT id, login_id AS loginId, role,
              created_at AS createdAt, created_at AS updatedAt
       FROM app_user
       WHERE enabled = TRUE AND login_id <> 'system' AND role <> 'DEVELOPER'
       ORDER BY CASE role WHEN 'ADMIN' THEN 0 ELSE 1 END, login_id, id`,
    );
    const [assignments] = await executor.query<AssignmentRow[]>(
      `SELECT user_id AS userId, admission_name AS admissionName
       FROM user_admission_assignment ORDER BY admission_name`,
    );
    const admissionsByUser = new Map<number, string[]>();
    for (const assignment of assignments) {
      const values = admissionsByUser.get(assignment.userId) ?? [];
      values.push(assignment.admissionName);
      admissionsByUser.set(assignment.userId, values);
    }
    return accounts.map((account) => ({
      ...account,
      role: toManagedAccountRole(account.role),
      admissionNames: admissionsByUser.get(account.id) ?? [],
    }));
  }

  async findOne(executor: SqlExecutor, id: number): Promise<ManagedAccountView | null> {
    const accounts = await this.list(executor);
    return accounts.find((account) => account.id === id) ?? null;
  }

  async listAdmissionNames(executor: SqlExecutor): Promise<string[]> {
    const [rows] = await executor.query<AdmissionRow[]>(
      `SELECT DISTINCT admission AS admissionName
       FROM candidate_record WHERE admission <> '' ORDER BY admission`,
    );
    return rows.map((row) => row.admissionName);
  }

  async findIdByLoginId(executor: SqlExecutor, loginId: string, exceptId?: number): Promise<number | null> {
    const parameters: (string | number)[] = [loginId];
    const exceptSql = exceptId === undefined ? "" : " AND id <> ?";
    if (exceptId !== undefined) parameters.push(exceptId);
    const [rows] = await executor.execute<IdRow[]>(
      `SELECT id FROM app_user WHERE login_id = ?${exceptSql} LIMIT 1`,
      parameters,
    );
    return rows[0]?.id ?? null;
  }

  async insertAccount(
    executor: SqlExecutor,
    loginId: string,
    role: StoredManagedAccountRole,
    passwordHash: string,
  ): Promise<number> {
    const [result] = await executor.execute<ResultSetHeader>(
      `INSERT INTO app_user (login_id, role, password_hash, enabled)
       VALUES (?, ?, ?, TRUE)`,
      [loginId, role, passwordHash],
    );
    return result.insertId;
  }

  async findTargetForUpdate(executor: SqlExecutor, id: number): Promise<AccountTarget | null> {
    const [rows] = await executor.execute<AccountTargetRow[]>(
      `SELECT id, role FROM app_user
       WHERE id = ? AND enabled = TRUE AND login_id <> 'system'
       LIMIT 1 FOR UPDATE`,
      [id],
    );
    return rows[0] ?? null;
  }

  async updateAccount(executor: SqlExecutor, id: number, values: AccountUpdateValues): Promise<void> {
    const passwordSql = values.passwordHash ? ", password_hash = ?" : "";
    const sessionSql = values.invalidateSessions ? ", session_version = session_version + 1" : "";
    const parameters = [values.loginId, values.role, ...(values.passwordHash ? [values.passwordHash] : []), id];
    await executor.execute(
      `UPDATE app_user SET login_id = ?, role = ?${passwordSql}${sessionSql} WHERE id = ?`,
      parameters,
    );
  }

  async disableAccount(executor: SqlExecutor, id: number): Promise<boolean> {
    const [result] = await executor.execute<ResultSetHeader>(
      `UPDATE app_user
       SET enabled = FALSE, session_version = session_version + 1
       WHERE id = ? AND enabled = TRUE`,
      [id],
    );
    return result.affectedRows > 0;
  }

  async deleteAdmissionAssignments(executor: SqlExecutor, userId: number): Promise<void> {
    await executor.execute("DELETE FROM user_admission_assignment WHERE user_id = ?", [userId]);
  }

  async insertAdmissionAssignment(executor: SqlExecutor, userId: number, admissionName: string): Promise<void> {
    await executor.execute("INSERT INTO user_admission_assignment (user_id, admission_name) VALUES (?, ?)", [
      userId,
      admissionName,
    ]);
  }
}
