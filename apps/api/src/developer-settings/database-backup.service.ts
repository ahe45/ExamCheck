import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { DATABASE_POOL } from "../database/database.constants.js";
import { verifyPassword } from "../auth/password.js";

const MAX_BYTES = 512 * 1024 * 1024;
const cell = z
  .string()
  .regex(/^(?:[0-9A-F]{2})*$/)
  .nullable();
const backupSchema = z.object({
  format: z.literal("examcheck-backup-v1"),
  createdAt: z.string().datetime(),
  schema: z.string(),
  tables: z.array(z.object({ name: z.string(), columns: z.array(z.string()), rows: z.array(z.array(cell)) })),
});
interface Column extends RowDataPacket {
  tableName: string;
  columnName: string;
  columnType: string;
  extra: string;
}
interface ForeignKey extends RowDataPacket {
  tableName: string;
  parent: string;
}
interface Table extends RowDataPacket {
  name: string;
  engine: string;
}
const quote = (name: string) => `\`${name.replaceAll("`", "``")}\``;

export function tableOrder(names: string[], keys: { tableName: string; parent: string }[]): string[] {
  const pending = new Set(names);
  const ordered: string[] = [];
  while (pending.size) {
    const ready = [...pending].filter((name) => !keys.some((key) => key.tableName === name && pending.has(key.parent)));
    if (!ready.length) throw new BadRequestException("순환 참조가 있는 데이터베이스는 복원할 수 없습니다.");
    for (const name of ready) {
      ordered.push(name);
      pending.delete(name);
    }
  }
  return ordered;
}

@Injectable()
export class DatabaseBackupService {
  private busy = false;
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  private async metadata(connection: PoolConnection) {
    const [tables] = await connection.query<Table[]>(
      `SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
    );
    if (tables.some((table) => table.engine !== "InnoDB"))
      throw new BadRequestException("InnoDB 테이블만 백업·복원할 수 있습니다.");
    const [columns] = await connection.query<Column[]>(
      `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, EXTRA AS extra, IS_NULLABLE, COLUMN_DEFAULT, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    );
    const [keys] = await connection.query<ForeignKey[]>(
      `SELECT TABLE_NAME AS tableName, REFERENCED_TABLE_NAME AS parent, COLUMN_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME, ORDINAL_POSITION FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
    );
    return {
      tables,
      columns,
      order: tableOrder(
        tables.map((table) => table.name),
        keys,
      ),
      signature: createHash("sha256").update(JSON.stringify({ tables, columns, keys })).digest("hex"),
    };
  }

  async backup(): Promise<Buffer> {
    if (this.busy) throw new ConflictException("백업 또는 복원이 진행 중입니다.");
    this.busy = true;
    const connection = await this.pool.getConnection().catch((error) => {
      this.busy = false;
      throw error;
    });
    try {
      await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
      const meta = await this.metadata(connection);
      const tables = [];
      for (const name of meta.order) {
        const columns = meta.columns
          .filter((column) => column.tableName === name && !/VIRTUAL GENERATED|STORED GENERATED/.test(column.extra))
          .map((column) => column.columnName);
        const [rows] = await connection.query<RowDataPacket[]>(
          `SELECT ${columns.map((column) => `HEX(CAST(${quote(column)} AS BINARY)) AS ${quote(column)}`).join(",")} FROM ${quote(name)}`,
        );
        tables.push({
          name,
          columns,
          rows:
            name === "candidate_upload_session"
              ? []
              : rows.map((row) => columns.map((column) => row[column] as string | null)),
        });
      }
      const json = Buffer.from(
        JSON.stringify({
          format: "examcheck-backup-v1",
          createdAt: new Date().toISOString(),
          schema: meta.signature,
          tables,
        }),
      );
      if (json.length > MAX_BYTES) throw new BadRequestException("백업 가능 크기(512MB)를 초과했습니다.");
      await connection.commit();
      const compressed = gzipSync(json);
      if (compressed.length > 100 * 1024 * 1024) throw new BadRequestException("압축 백업 크기(100MB)를 초과했습니다.");
      return compressed;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
      this.busy = false;
    }
  }

  async restore(file: Buffer | undefined, password: unknown, confirmation: unknown, userId: number) {
    if (!file || confirmation !== "복원" || typeof password !== "string")
      throw new BadRequestException("백업 파일, 개발자 비밀번호와 복원 확인 문구를 입력해 주세요.");
    if (this.busy) throw new ConflictException("백업 또는 복원이 진행 중입니다.");
    this.busy = true;
    const connection = await this.pool.getConnection().catch((error) => {
      this.busy = false;
      throw error;
    });
    let locked = false;
    try {
      const [users] = await connection.execute<RowDataPacket[]>(
        "SELECT password_hash FROM app_user WHERE id = ? AND role = 'DEVELOPER' AND enabled = TRUE",
        [userId],
      );
      if (!users[0]?.password_hash || !(await verifyPassword(password, users[0].password_hash as string)))
        throw new ForbiddenException("개발자 비밀번호가 올바르지 않습니다.");
      let data: z.infer<typeof backupSchema>;
      try {
        data = backupSchema.parse(JSON.parse(gunzipSync(file, { maxOutputLength: MAX_BYTES }).toString("utf8")));
      } catch {
        throw new BadRequestException("올바른 ExamCheck 백업 파일이 아닙니다.");
      }
      const meta = await this.metadata(connection);
      if (
        data.schema !== meta.signature ||
        data.tables.length !== meta.order.length ||
        new Set(data.tables.map((table) => table.name)).size !== meta.order.length
      )
        throw new BadRequestException("현재 데이터베이스 구조와 일치하는 백업 파일만 복원할 수 있습니다.");
      for (const name of meta.order) {
        const table = data.tables.find((table) => table.name === name);
        const columns = meta.columns
          .filter((column) => column.tableName === name && !/VIRTUAL GENERATED|STORED GENERATED/.test(column.extra))
          .map((column) => column.columnName);
        if (
          !table ||
          JSON.stringify(table.columns) !== JSON.stringify(columns) ||
          table.rows.some((row) => row.length !== columns.length)
        )
          throw new BadRequestException("백업 테이블 또는 컬럼이 일치하지 않습니다.");
      }
      await connection.query("SET autocommit = 0");
      await connection.query(`LOCK TABLES ${meta.order.map((name) => `${quote(name)} WRITE`).join(",")}`);
      locked = true;
      for (const name of [...meta.order].reverse()) await connection.query(`DELETE FROM ${quote(name)}`);
      for (const name of meta.order) {
        const table = data.tables.find((table) => table.name === name)!;
        const sql = `INSERT INTO ${quote(name)} (${table.columns.map(quote).join(",")}) VALUES (${table.columns.map(() => "?").join(",")})`;
        for (const row of table.rows)
          await connection.execute(
            sql,
            row.map((value) => (value === null ? null : Buffer.from(value, "hex"))),
          );
      }
      await connection.query("UPDATE app_user SET session_version = session_version + 1, last_access_at = NULL");
      await connection.commit();
      return { restored: true };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      // A dedicated connection is discarded so table locks and transaction settings cannot leak into the pool.
      if (locked) await connection.query("UNLOCK TABLES").catch(() => {});
      connection.destroy();
      this.busy = false;
    }
  }
}
