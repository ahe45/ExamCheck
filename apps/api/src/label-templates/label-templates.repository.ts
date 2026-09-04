import { Injectable } from "@nestjs/common";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import type { LabelTemplateLayout } from "./label-template-layout.js";

export interface LabelTemplateRecord {
  id: number;
  code: string;
  name: string;
  description: string | null;
  zplTemplate: string;
  layout: LabelTemplateLayout;
  active: boolean;
  createdAt: string | Date;
  createdByLoginId: string;
}

interface LabelTemplateRow extends RowDataPacket {
  id: number;
  code: string;
  name: string;
  description: string | null;
  zplTemplate: string;
  layout: string | LabelTemplateLayout | null;
  active: number | boolean;
  createdAt: string | Date;
  createdByLoginId: string;
}

@Injectable()
export class LabelTemplatesRepository {
  async list(executor: SqlExecutor, activeOnly = false): Promise<LabelTemplateRecord[]> {
    const [rows] = await executor.execute<LabelTemplateRow[]>(
      `${selectSql}${activeOnly ? " WHERE template.active = TRUE" : ""} ORDER BY template.name, template.id`,
    );
    return rows.map(toRecord);
  }

  async findForUpdate(executor: SqlExecutor, code: string): Promise<LabelTemplateRow | null> {
    const [rows] = await executor.execute<LabelTemplateRow[]>(
      `${selectSql} WHERE template.code = ? LIMIT 1 FOR UPDATE`,
      [code],
    );
    return rows[0] ?? null;
  }

  async insert(
    executor: SqlExecutor,
    input: {
      code: string;
      name: string;
      description?: string;
      zplTemplate: string;
      layout: LabelTemplateLayout;
      active: boolean;
      createdBy: number;
    },
  ): Promise<number> {
    const [result] = await executor.execute<ResultSetHeader>(
      `INSERT INTO label_template
        (code, name, description, zpl_template, layout_json, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.code,
        input.name,
        input.description?.trim() || null,
        input.zplTemplate,
        JSON.stringify(input.layout),
        input.active,
        input.createdBy,
      ],
    );
    return result.insertId;
  }

  async update(
    executor: SqlExecutor,
    id: number,
    input: {
      name: string;
      description?: string;
      zplTemplate: string;
      layout: LabelTemplateLayout;
      active: boolean;
    },
  ): Promise<void> {
    const [result] = await executor.execute<ResultSetHeader>(
      `UPDATE label_template
       SET name = ?, description = ?, zpl_template = ?, layout_json = ?, active = ?
       WHERE id = ?`,
      [
        input.name,
        input.description?.trim() || null,
        input.zplTemplate,
        JSON.stringify(input.layout),
        input.active,
        id,
      ],
    );
    assertSingleUpdate(result);
  }

  async updateMetadata(
    executor: SqlExecutor,
    id: number,
    input: { name: string; description?: string },
  ): Promise<void> {
    const [result] = await executor.execute<ResultSetHeader>(
      "UPDATE label_template SET name = ?, description = ? WHERE id = ?",
      [input.name.trim(), input.description?.trim() || null, id],
    );
    assertSingleUpdate(result);
  }

  async updateActive(executor: SqlExecutor, id: number, active: boolean): Promise<void> {
    const [result] = await executor.execute<ResultSetHeader>("UPDATE label_template SET active = ? WHERE id = ?", [
      active,
      id,
    ]);
    assertSingleUpdate(result);
  }

  async clearSettingAssignments(executor: SqlExecutor, id: number): Promise<void> {
    await executor.execute("UPDATE pseudonym_setting SET label_template_id = NULL WHERE label_template_id = ?", [id]);
  }

  async delete(executor: SqlExecutor, id: number): Promise<void> {
    const [result] = await executor.execute<ResultSetHeader>("DELETE FROM label_template WHERE id = ?", [id]);
    assertSingleUpdate(result);
  }
}

const selectSql = `SELECT template.id, template.code, template.name, template.description,
  template.zpl_template AS zplTemplate, template.layout_json AS layout, template.active,
  template.created_at AS createdAt, creator.login_id AS createdByLoginId
 FROM label_template template
 INNER JOIN app_user creator ON creator.id = template.created_by`;

function assertSingleUpdate(result: ResultSetHeader): void {
  if (Number(result.affectedRows) !== 1) throw new Error("Label template changed concurrently or no longer exists.");
}

function toRecord(row: LabelTemplateRow): LabelTemplateRecord {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    description: row.description,
    zplTemplate: row.zplTemplate,
    layout:
      typeof row.layout === "string"
        ? (JSON.parse(row.layout) as LabelTemplateLayout)
        : (row.layout as LabelTemplateLayout),
    active: Boolean(row.active),
    createdAt: row.createdAt,
    createdByLoginId: row.createdByLoginId,
  };
}
