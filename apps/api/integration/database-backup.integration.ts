import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Connection, type Pool, type RowDataPacket } from "mysql2/promise";
import { randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { loadDatabaseCliConfig } from "../src/database/database-cli-runtime.js";
import { DatabaseBackupService } from "../src/developer-settings/database-backup.service.js";
import { hashPassword } from "../src/auth/password.js";

const database = `examcheck_backup_test_${randomBytes(6).toString("hex")}`;
let admin: Connection;
let pool: Pool;
let service: DatabaseBackupService;
let backup: Buffer;
const password = "backup-test-password";
beforeAll(async () => {
  const config = loadDatabaseCliConfig();
  admin = await mysql.createConnection(config.connection);
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
  pool = mysql.createPool({ ...config.connection, database });
  await pool.query(
    "CREATE TABLE app_user (id BIGINT PRIMARY KEY, role VARCHAR(20), enabled BOOLEAN, password_hash VARCHAR(255), session_version INT, last_access_at DATETIME(3)) ENGINE=InnoDB",
  );
  await pool.query(
    "CREATE TABLE photo (id INT PRIMARY KEY, owner_id BIGINT, content LONGBLOB, name VARCHAR(50), value DECIMAL(20,5), captured DATETIME(3), FOREIGN KEY (owner_id) REFERENCES app_user(id)) ENGINE=InnoDB",
  );
  await pool.execute("INSERT INTO app_user VALUES (1, 'DEVELOPER', TRUE, ?, 2, NOW(3))", [
    await hashPassword(password),
  ]);
  await pool.execute("INSERT INTO photo VALUES (1, 1, ?, '한글 사진', 123456789.12345, '2026-10-30 12:34:56.789')", [
    Buffer.from([0, 255, 128, 10]),
  ]);
  service = new DatabaseBackupService(pool);
  backup = await service.backup();
});
afterAll(async () => {
  await pool?.end();
  if (admin) {
    await admin.query(`DROP DATABASE \`${database}\``);
    await admin.end();
  }
});
describe("database backup and restore", () => {
  it("restores exact binary, text, decimal and date values and invalidates sessions", async () => {
    await pool.query("UPDATE photo SET name = 'changed'");
    await service.restore(backup, password, "복원", 1);
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT HEX(content) AS content, name, value, DATE_FORMAT(captured, '%Y-%m-%d %H:%i:%s.%f') AS captured FROM photo",
    );
    expect(rows[0]).toMatchObject({
      content: "00FF800A",
      name: "한글 사진",
      value: "123456789.12345",
      captured: "2026-10-30 12:34:56.789000",
    });
    const [users] = await pool.query<RowDataPacket[]>("SELECT session_version, last_access_at FROM app_user");
    expect(users[0]).toMatchObject({ session_version: 3, last_access_at: null });
  });
  it("rolls back all deletes and inserts on foreign key failure", async () => {
    const data = JSON.parse(gunzipSync(backup).toString());
    const photo = data.tables.find((table: { name: string }) => table.name === "photo");
    photo.rows[0][photo.columns.indexOf("owner_id")] = Buffer.from("999").toString("hex").toUpperCase();
    await pool.query("UPDATE photo SET name = 'keep me'");
    await expect(service.restore(gzipSync(JSON.stringify(data)), password, "복원", 1)).rejects.toThrow();
    const [rows] = await pool.query<RowDataPacket[]>("SELECT name FROM photo");
    expect(rows[0].name).toBe("keep me");
  });
  it("rejects invalid files, wrong passwords and mismatched schemas before changing data", async () => {
    await expect(service.restore(Buffer.from("invalid"), password, "복원", 1)).rejects.toThrow("백업 파일");
    await expect(service.restore(backup, "wrong", "복원", 1)).rejects.toThrow("비밀번호");
    const data = JSON.parse(gunzipSync(backup).toString());
    data.schema = "wrong";
    await expect(service.restore(gzipSync(JSON.stringify(data)), password, "복원", 1)).rejects.toThrow("구조");
  });
});
