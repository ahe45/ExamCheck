import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { DATABASE_POOL } from "../database/database.constants.js";
import type { CreateWorkstationInput } from "./workstations.types.js";

interface WorkstationRow extends RowDataPacket {
  id: number;
  code: string;
  name: string;
  location: string | null;
  description: string | null;
  enabled: number;
  createdAt: Date;
}

export interface WorkstationRecord {
  id: number;
  code: string;
  name: string;
  location: string | null;
  description: string | null;
  enabled: boolean;
  createdAt?: Date;
}

@Injectable()
export class WorkstationsRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async list(): Promise<WorkstationRecord[]> {
    const [rows] = await this.pool.query<WorkstationRow[]>(`
      SELECT id, code, name, location, description, enabled, created_at AS createdAt
      FROM workstation
      ORDER BY code
    `);
    return rows.map(mapWorkstation);
  }

  async insert(connection: PoolConnection, input: CreateWorkstationInput): Promise<WorkstationRecord> {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO workstation (code, name, location, description) VALUES (?, ?, ?, ?)`,
      [input.code, input.name, input.location ?? null, input.description ?? null],
    );
    return {
      id: result.insertId,
      code: input.code,
      name: input.name,
      location: input.location ?? null,
      description: input.description ?? null,
      enabled: true,
    };
  }
}

function mapWorkstation(row: WorkstationRow): WorkstationRecord {
  return { ...row, enabled: Boolean(row.enabled) };
}
