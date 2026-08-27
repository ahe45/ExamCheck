import { Inject, Injectable } from "@nestjs/common";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { UserRole } from "./auth.types.js";
import { DATABASE_POOL } from "../database/database.constants.js";

export interface AuthUserRow extends RowDataPacket {
  id: number;
  loginId: string;
  role: UserRole;
  passwordHash: string | null;
  enabled: number;
  sessionVersion: number;
}

interface AdmissionRow extends RowDataPacket {
  admissionName: string;
}

@Injectable()
export class AuthRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  findUserByLoginId(loginId: string): Promise<AuthUserRow | null> {
    return this.findUser("login_id", loginId);
  }

  findUserById(id: number): Promise<AuthUserRow | null> {
    return this.findUser("id", id);
  }

  async listAdmissionNames(userId: number): Promise<string[]> {
    const [rows] = await this.pool.execute<AdmissionRow[]>(
      `SELECT admission_name AS admissionName
       FROM user_admission_assignment WHERE user_id = ? ORDER BY admission_name`,
      [userId],
    );
    return rows.map((row) => row.admissionName);
  }

  private async findUser(column: "id" | "login_id", value: number | string): Promise<AuthUserRow | null> {
    const [rows] = await this.pool.execute<AuthUserRow[]>(
      `SELECT id, login_id AS loginId, role,
              password_hash AS passwordHash, enabled, session_version AS sessionVersion
       FROM app_user WHERE ${column} = ? LIMIT 1`,
      [value],
    );
    return rows[0] ?? null;
  }
}
