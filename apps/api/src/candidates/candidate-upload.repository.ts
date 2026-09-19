import { Injectable } from "@nestjs/common";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import type { SqlExecutor } from "../common/database/sql-executor.js";
export interface UploadSessionRow extends RowDataPacket {
  id: string;
  ownerId: number;
  kind: "WORKBOOK" | "PHOTO_ARCHIVE" | "CANDIDATE_EXPORT";
  status: string;
  checksum: string;
  stateChecksum: string;
  policy: string | null;
  preview: string | object | null;
  result: string | object | null;
  error: string | null;
  processed: number;
  total: number;
}
@Injectable()
export class CandidateUploadRepository {
  async find(executor: SqlExecutor, id: string, owner: number) {
    const [rows] = await executor.execute<UploadSessionRow[]>(
      `SELECT id, owner_id AS ownerId, kind, status, checksum, state_checksum AS stateChecksum, policy, preview_json AS preview, result_json AS result, error_message AS error, processed, total
     FROM candidate_upload_session WHERE id = ? AND owner_id = ? AND expires_at > NOW(3)`,
      [id, owner],
    );
    return rows[0] ?? null;
  }
  async insert(
    executor: SqlExecutor,
    input: { id: string; owner: number; kind: string; fileName: string; checksum: string },
  ) {
    const [counts] = await executor.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM candidate_upload_session WHERE status IN ('PARSING','PREVIEW','QUEUED','RUNNING') AND expires_at > NOW(3)",
    );
    if (Number(counts[0].count) >= 20)
      throw new Error("서버에 대기 중인 업로드가 많습니다. 잠시 후 다시 시도해 주세요.");
    await executor.execute(
      "INSERT INTO candidate_upload_session (id, owner_id, kind, status, file_name, checksum, expires_at) VALUES (?, ?, ?, 'PARSING', ?, ?, DATE_ADD(NOW(3), INTERVAL 30 MINUTE))",
      [input.id, input.owner, input.kind, input.fileName.slice(0, 255), input.checksum],
    );
  }
  async preview(executor: SqlExecutor, id: string, state: string, preview: object, total: number) {
    await executor.execute(
      "UPDATE candidate_upload_session SET status = 'PREVIEW', state_checksum = ?, preview_json = ?, total = ? WHERE id = ? AND status = 'PARSING'",
      [state, JSON.stringify(preview), total, id],
    );
  }
  async enqueue(executor: SqlExecutor, id: string, owner: number, policy: string) {
    const [result] = await executor.execute<ResultSetHeader>(
      "UPDATE candidate_upload_session SET status = 'QUEUED', policy = ?, expires_at = DATE_ADD(NOW(3), INTERVAL 24 HOUR) WHERE id = ? AND owner_id = ? AND status = 'PREVIEW' AND expires_at > NOW(3)",
      [policy, id, owner],
    );
    return result.affectedRows === 1;
  }
  async running(executor: SqlExecutor, id: string) {
    await executor.execute(
      "UPDATE candidate_upload_session SET status = 'RUNNING' WHERE id = ? AND status = 'QUEUED'",
      [id],
    );
  }
  async progress(executor: SqlExecutor, id: string, processed: number) {
    await executor.execute(
      "UPDATE candidate_upload_session SET processed = LEAST(?, total) WHERE id = ? AND status = 'RUNNING'",
      [processed, id],
    );
  }
  async success(executor: SqlExecutor, id: string, result: object) {
    await executor.execute(
      "UPDATE candidate_upload_session SET status = 'SUCCEEDED', processed = total, result_json = ?, error_message = NULL WHERE id = ? AND status = 'RUNNING'",
      [JSON.stringify(result), id],
    );
  }
  async failure(executor: SqlExecutor, id: string, message: string) {
    await executor.execute(
      "UPDATE candidate_upload_session SET status = 'FAILED', error_message = ? WHERE id = ? AND status IN ('PARSING','PREVIEW','QUEUED','RUNNING')",
      [message.slice(0, 1000), id],
    );
  }
  async interrupted(executor: SqlExecutor) {
    await executor.execute(
      "UPDATE candidate_upload_session SET status = 'FAILED', error_message = '서버 재시작으로 작업이 중단되었습니다. 미리보기부터 다시 진행해 주세요.' WHERE status IN ('PARSING','QUEUED','RUNNING')",
    );
  }
  async expired(executor: SqlExecutor) {
    const [rows] = await executor.query<RowDataPacket[]>(
      "SELECT id FROM candidate_upload_session WHERE expires_at <= NOW(3) AND status NOT IN ('QUEUED','RUNNING')",
    );
    return rows.map((row) => String(row.id));
  }
  async remove(executor: SqlExecutor, id: string) {
    await executor.execute("DELETE FROM candidate_upload_session WHERE id = ? AND expires_at <= NOW(3)", [id]);
  }
}
