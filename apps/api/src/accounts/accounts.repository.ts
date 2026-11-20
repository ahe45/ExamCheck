import { Injectable } from "@nestjs/common";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { UserRole } from "../auth/auth.types.js";
import { resolveClassifiedAccess, type ClassificationMethod } from "../authorization/classification.js";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { toManagedAccountRole, type StoredManagedAccountRole } from "./accounts.domain.js";

interface AccountRow extends RowDataPacket {
  id: number;
  loginId: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date | null;
  lastAccessAt: Date | null;
  isOnline: number;
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
  lastAccessAt: Date | null;
  isOnline: number;
  admissionNames: string[];
  scopeBlocked?: boolean;
}

export interface AccountUpdateValues {
  loginId: string;
  role: StoredManagedAccountRole;
  passwordHash?: string;
  invalidateSessions: boolean;
}

@Injectable()
export class AccountsRepository {
  async list(executor: SqlExecutor, method?: ClassificationMethod): Promise<ManagedAccountView[]> {
    const [accounts] = await executor.query<AccountRow[]>(
      `SELECT id, login_id AS loginId, role,
              created_at AS createdAt, created_at AS updatedAt,
              last_access_at AS lastAccessAt,
              COALESCE(last_access_at > DATE_SUB(NOW(3), INTERVAL 2 MINUTE), FALSE) AS isOnline
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
    if (method) {
      const [classified] = await executor.execute<Array<AssignmentRow & { method: string }>>(
        `SELECT user_id AS userId, classification_method AS method, scope_key AS admissionName
         FROM user_classification_assignment ORDER BY scope_key`,
      );
      const classifiedByUser = new Map<number, typeof classified>();
      for (const assignment of classified) {
        const assigned = classifiedByUser.get(assignment.userId) ?? [];
        assigned.push(assignment);
        classifiedByUser.set(assignment.userId, assigned);
      }
      return accounts.map((account) => {
        const legacy = admissionsByUser.get(account.id) ?? [];
        const classified = classifiedByUser.get(account.id) ?? [];
        const access = resolveClassifiedAccess(
          [
            ...legacy.map((scopeKey) => ({ method: "ADMISSION", scopeKey, legacy: true })),
            ...classified.map(({ method, admissionName }) => ({ method, scopeKey: admissionName })),
          ],
          method,
        );
        return {
          ...account,
          role: toManagedAccountRole(account.role),
          admissionNames: access.admissionNames,
          scopeBlocked: account.role !== "ADMIN" && access.scopeBlocked,
        };
      });
    }
    return accounts.map((account) => ({
      ...account,
      role: toManagedAccountRole(account.role),
      admissionNames: admissionsByUser.get(account.id) ?? [],
    }));
  }

  async findOne(
    executor: SqlExecutor,
    id: number,
    method: ClassificationMethod = "ADMISSION",
  ): Promise<ManagedAccountView | null> {
    const accounts = await this.list(executor, method);
    return accounts.find((account) => account.id === id) ?? null;
  }

  async listAdmissionNames(executor: SqlExecutor): Promise<string[]> {
    const [rows] = await executor.query<AdmissionRow[]>(
      `SELECT DISTINCT admission AS admissionName
       FROM candidate_record WHERE admission <> '' ORDER BY admission`,
    );
    return rows.map((row) => row.admissionName);
  }

  async listClassificationScopes(executor: SqlExecutor, method: ClassificationMethod) {
    const [rows] = await executor.execute<Array<RowDataPacket & { key: string; label: string }>>(
      `SELECT operation_scope AS \u0060key\u0060, MIN(operation_scope_label) AS label
       FROM operation_candidate_record WHERE classification_method = ? AND operation_scope <> ''
       GROUP BY operation_scope ORDER BY label, operation_scope`,
      [method],
    );
    return rows;
  }

  async lockClassificationMethod(executor: SqlExecutor): Promise<ClassificationMethod> {
    const [rows] = await executor.query<Array<RowDataPacket & { method: ClassificationMethod }>>(
      "SELECT classification_method AS method FROM system_profile WHERE id = 1 LOCK IN SHARE MODE",
    );
    return rows[0].method;
  }

  async replaceClassificationAssignments(
    executor: SqlExecutor,
    userId: number,
    method: ClassificationMethod,
    scopes: string[],
  ) {
    await executor.execute(
      "DELETE FROM user_classification_assignment WHERE user_id = ? AND classification_method = ?",
      [userId, method],
    );
    const keys = scopes.length ? scopes : ["*"];
    await executor.execute(
      `INSERT INTO user_classification_assignment (user_id, classification_method, scope_key)
       VALUES ${keys.map(() => "(?, ?, ?)").join(", ")}`,
      keys.flatMap((key) => [userId, method, key]),
    );
  }

  async setUnrestrictedAdmissionAccess(executor: SqlExecutor, userId: number, enabled: boolean) {
    if (enabled) {
      await this.replaceClassificationAssignments(executor, userId, "ADMISSION", []);
    } else {
      await executor.execute(
        "DELETE FROM user_classification_assignment WHERE user_id = ? AND classification_method = 'ADMISSION'",
        [userId],
      );
    }
  }

  async deleteClassificationAssignments(executor: SqlExecutor, userId: number) {
    await executor.execute("DELETE FROM user_classification_assignment WHERE user_id = ?", [userId]);
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
