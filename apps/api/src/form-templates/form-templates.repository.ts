import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { DATABASE_POOL } from "../database/database.constants.js";
import type {
  FormTemplateUsageScope,
  SaveFormTemplateInput,
  UpdateFormTemplateMetadataInput,
} from "./form-templates.types.js";

interface FormTemplateRow extends RowDataPacket {
  id: number;
  code: string;
  version: number;
  name: string;
  description: string | null;
  category: string;
  usageScope: FormTemplateUsageScope;
  layout: string | Record<string, unknown>;
  active: number | boolean;
  createdAt: Date;
  createdByLoginId: string;
}

export type FormTemplateRecord = Omit<FormTemplateRow, "layout" | "active"> & {
  layout: Record<string, unknown>;
  active: boolean;
};

const templateSelect = `SELECT ft.id, ft.code, ft.version, ft.name, ft.description, ft.category,
       ft.usage_scope AS usageScope, ft.layout_json AS layout, ft.active,
       ft.created_at AS createdAt, u.login_id AS createdByLoginId`;

@Injectable()
export class FormTemplatesRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async listLatest(activeOnly: boolean): Promise<FormTemplateRecord[]> {
    const [rows] = await this.pool.execute<FormTemplateRow[]>(
      `${templateSelect}
       FROM form_template ft
       INNER JOIN (
         SELECT code, MAX(version) AS version FROM form_template GROUP BY code
       ) latest ON latest.code = ft.code AND latest.version = ft.version
       INNER JOIN app_user u ON u.id = ft.created_by
       ${activeOnly ? "WHERE ft.active = TRUE" : ""}
       ORDER BY ft.category, ft.name`,
    );
    return rows.map(mapTemplate);
  }

  async findActive(code: string): Promise<FormTemplateRecord | null> {
    const [rows] = await this.pool.execute<FormTemplateRow[]>(
      `${templateSelect}
       FROM form_template ft
       INNER JOIN app_user u ON u.id = ft.created_by
       WHERE ft.code = ? AND ft.active = TRUE
       ORDER BY ft.version DESC LIMIT 1`,
      [code],
    );
    return rows[0] ? mapTemplate(rows[0]) : null;
  }

  async nextVersionForUpdate(connection: PoolConnection, code: string): Promise<number> {
    const [rows] = await connection.execute<Array<RowDataPacket & { version: number | null }>>(
      "SELECT MAX(version) AS version FROM form_template WHERE code = ? FOR UPDATE",
      [code],
    );
    return Number(rows[0]?.version || 0) + 1;
  }

  async deactivateActiveVersions(connection: PoolConnection, code: string): Promise<void> {
    await connection.execute("UPDATE form_template SET active = FALSE WHERE code = ? AND active = TRUE", [code]);
  }

  async insert(
    connection: PoolConnection,
    input: SaveFormTemplateInput,
    code: string,
    version: number,
    createdBy: number,
  ): Promise<void> {
    await connection.execute(
      `INSERT INTO form_template
        (code, version, name, description, category, usage_scope, layout_json, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code,
        version,
        input.name.trim(),
        input.description?.trim() || null,
        input.category.trim(),
        input.usageScope,
        JSON.stringify(input.layout),
        input.active !== false,
        createdBy,
      ],
    );
  }

  async findLatestIdForUpdate(connection: PoolConnection, code: string): Promise<number | null> {
    const [rows] = await connection.execute<Array<RowDataPacket & { id: number }>>(
      "SELECT id FROM form_template WHERE code = ? ORDER BY version DESC LIMIT 1 FOR UPDATE",
      [code],
    );
    const id = Number(rows[0]?.id || 0);
    return id || null;
  }

  async updateMetadata(
    connection: PoolConnection,
    templateId: number,
    input: UpdateFormTemplateMetadataInput,
  ): Promise<void> {
    await connection.execute("UPDATE form_template SET name = ?, description = ? WHERE id = ?", [
      input.name.trim(),
      input.description?.trim() || null,
      templateId,
    ]);
  }
}

function mapTemplate(row: FormTemplateRow): FormTemplateRecord {
  return {
    ...row,
    active: Boolean(row.active),
    layout: typeof row.layout === "string" ? (JSON.parse(row.layout) as Record<string, unknown>) : row.layout,
  };
}
