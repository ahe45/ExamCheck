import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { DATABASE_POOL } from "../database/database.constants.js";
import type {
  FormTemplateUsageScope,
  SaveFormTemplateInput,
  UpdateFormTemplateMetadataInput,
} from "./form-templates.types.js";

interface FormTemplateRow extends RowDataPacket {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: string;
  usageScope: FormTemplateUsageScope;
  layout: string | Record<string, unknown>;
  active: number | boolean;
  deleted?: number | boolean;
  createdAt: Date;
  createdByLoginId: string;
}

export type FormTemplateRecord = Omit<FormTemplateRow, "layout" | "active"> & {
  layout: Record<string, unknown>;
  active: boolean;
};

export interface LockedFormTemplate {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: string;
  usageScope: FormTemplateUsageScope;
  layout: Record<string, unknown>;
  active: boolean;
  deleted: boolean;
}

const templateSelect = `SELECT ft.id, ft.code, ft.name, ft.description, ft.category,
       ft.usage_scope AS usageScope, ft.layout_json AS layout, ft.active,
       ft.created_at AS createdAt, u.login_id AS createdByLoginId`;

@Injectable()
export class FormTemplatesRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async list(activeOnly: boolean): Promise<FormTemplateRecord[]> {
    const [rows] = await this.pool.execute<FormTemplateRow[]>(
      `${templateSelect}
       FROM form_template ft
       INNER JOIN app_user u ON u.id = ft.created_by
       WHERE NOT EXISTS (SELECT 1 FROM form_template_deletion deletion WHERE deletion.code = ft.code)
         ${activeOnly ? "AND ft.active = TRUE" : ""}
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
         AND NOT EXISTS (SELECT 1 FROM form_template_deletion deletion WHERE deletion.code = ft.code)
       LIMIT 1`,
      [code],
    );
    return rows[0] ? mapTemplate(rows[0]) : null;
  }

  async insert(
    connection: PoolConnection,
    input: SaveFormTemplateInput,
    code: string,
    createdBy: number,
  ): Promise<number> {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO form_template
        (code, name, description, category, usage_scope, layout_json, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code,
        input.name.trim(),
        input.description?.trim() || null,
        input.category.trim(),
        input.usageScope,
        JSON.stringify(input.layout),
        input.active !== false,
        createdBy,
      ],
    );
    return result.insertId;
  }

  async findForUpdate(connection: PoolConnection, code: string): Promise<LockedFormTemplate | null> {
    const [rows] = await connection.execute<FormTemplateRow[]>(
      `SELECT id, code, name, description, category, usage_scope AS usageScope,
              layout_json AS layout, active, created_at AS createdAt, '' AS createdByLoginId,
              EXISTS (SELECT 1 FROM form_template_deletion deletion WHERE deletion.code = form_template.code) AS deleted
       FROM form_template
       WHERE code = ? LIMIT 1 FOR UPDATE`,
      [code],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      code: row.code,
      name: row.name,
      description: row.description,
      category: row.category,
      usageScope: row.usageScope,
      layout: parseLayout(row.layout),
      active: Boolean(row.active),
      deleted: Boolean(row.deleted),
    };
  }

  async restoreDeletedCode(connection: PoolConnection, code: string): Promise<void> {
    await connection.execute(`DELETE FROM form_template_deletion WHERE code = ?`, [code]);
  }

  async markDeleted(connection: PoolConnection, code: string, deletedBy: number): Promise<void> {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO form_template_deletion (code, deleted_by) VALUES (?, ?)`,
      [code, deletedBy],
    );
    if (Number(result.affectedRows) !== 1) throw new Error("Form template deletion was not recorded.");
  }

  async update(connection: PoolConnection, templateId: number, input: SaveFormTemplateInput): Promise<void> {
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE form_template
       SET name = ?, description = ?, category = ?, usage_scope = ?, layout_json = ?, active = ?
       WHERE id = ?`,
      [
        input.name.trim(),
        input.description?.trim() || null,
        input.category.trim(),
        input.usageScope,
        JSON.stringify(input.layout),
        input.active !== false,
        templateId,
      ],
    );
    assertSingleUpdate(result);
  }

  async updateMetadata(
    connection: PoolConnection,
    templateId: number,
    input: UpdateFormTemplateMetadataInput,
  ): Promise<void> {
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE form_template SET name = ?, description = ? WHERE id = ?`,
      [input.name.trim(), input.description?.trim() || null, templateId],
    );
    assertSingleUpdate(result);
  }

  async updateActive(connection: PoolConnection, templateId: number, active: boolean): Promise<void> {
    const [result] = await connection.execute<ResultSetHeader>(`UPDATE form_template SET active = ? WHERE id = ?`, [
      active,
      templateId,
    ]);
    assertSingleUpdate(result);
  }
}

function assertSingleUpdate(result: ResultSetHeader): void {
  if (Number(result.affectedRows) !== 1) {
    throw new Error("Form template changed concurrently or no longer exists.");
  }
}

function parseLayout(layout: string | Record<string, unknown>): Record<string, unknown> {
  return typeof layout === "string" ? (JSON.parse(layout) as Record<string, unknown>) : layout;
}

function mapTemplate(row: FormTemplateRow): FormTemplateRecord {
  return {
    ...row,
    active: Boolean(row.active),
    layout: parseLayout(row.layout),
  };
}
