import type { RowDataPacket } from "mysql2/promise";
import type { SqlExecutor } from "../common/database/sql-executor.js";

// Use the same template resolution for the operator's defaults and the print job.
export async function findActiveLabelTemplate(executor: SqlExecutor, labelTemplateId: number | null, locking = false) {
  const [rows] = await executor.execute<
    Array<
      RowDataPacket & {
        id: number;
        name: string;
        defaultCopies: number;
        zplTemplate: string;
        layout: string | null;
      }
    >
  >(
    `SELECT id, name, default_copies AS defaultCopies, zpl_template AS zplTemplate, layout_json AS layout
     FROM label_template
     WHERE active = TRUE AND (? IS NULL OR id = ?)
     ORDER BY CASE WHEN code = 'PSEUDONYM_LABEL' THEN 0 ELSE 1 END, id
     LIMIT 1${locking ? " LOCK IN SHARE MODE" : ""}`,
    [labelTemplateId, labelTemplateId],
  );
  return rows[0] ?? null;
}
