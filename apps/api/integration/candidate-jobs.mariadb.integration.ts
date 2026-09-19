import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import type { RowDataPacket } from "mysql2/promise";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createMariaDbIntegrationHarness, type MariaDbIntegrationHarness } from "../test-support/mariadb-harness.js";
import { CandidateUploadService } from "../src/candidates/candidate-upload.service.js";
import { CandidateUploadRepository } from "../src/candidates/candidate-upload.repository.js";
import { CandidatesRepository } from "../src/candidates/candidates.repository.js";
import { CandidatesService } from "../src/candidates/candidates.service.js";
import { CandidatesApplicationService } from "../src/candidates/candidates.application.js";
import { MutationAuditRepository } from "../src/common/audit/mutation-audit.repository.js";
import { resolveAppConfig } from "../src/config/app-config.js";

describe("durable candidate jobs", () => {
  let harness: MariaDbIntegrationHarness;
  let uploads: CandidateUploadService;
  let service: CandidatesService;
  let owner: number;
  let directory: string;
  beforeAll(async () => {
    harness = await createMariaDbIntegrationHarness();
    directory = await mkdtemp(join(tmpdir(), "examcheck-job-fixture-"));
    const config = resolveAppConfig({ DB_NAME: harness.databaseName });
    const repository = new CandidatesRepository();
    const app = new CandidatesApplicationService(harness.pool, repository, new MutationAuditRepository(), config);
    service = new CandidatesService(harness.pool, repository, app, config);
    uploads = new CandidateUploadService(
      harness.pool,
      config,
      repository,
      app,
      new CandidateUploadRepository(),
      service,
    );
    await uploads.onModuleInit();
    const [rows] = await harness.pool.query<RowDataPacket[]>("SELECT id FROM app_user WHERE login_id = 'system'");
    owner = Number(rows[0].id);
  });
  afterAll(async () => {
    await uploads?.onModuleDestroy();
    await harness?.pool.execute("UPDATE candidate_upload_session SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 HOUR)");
    await uploads?.onModuleInit();
    await uploads?.onModuleDestroy();
    await harness?.cleanup();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("reuses one parsed workbook, rejects another owner, and commits data and result once", async () => {
    const path = join(directory, "candidates.xlsx");
    await writeFile(path, await service.buildTemplate());
    const preview = await uploads.preview(
      {
        path,
        originalname: "candidates.xlsx",
        mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: (await stat(path)).size,
      },
      "WORKBOOK",
      owner,
    );
    await expect(uploads.enqueue(preview.previewToken, owner + 99999, "insert-update", "WORKBOOK")).rejects.toThrow(
      "접근",
    );
    await expect(uploads.status(preview.previewToken, owner + 99999)).rejects.toThrow("접근");
    const [first, retry] = await Promise.all([
      uploads.enqueue(preview.previewToken, owner, "insert-update", "WORKBOOK"),
      uploads.enqueue(preview.previewToken, owner, "insert-update", "WORKBOOK"),
    ]);
    expect(retry).toEqual(first);
    expect((await completed(first.jobId)).result).toMatchObject({ inserted: 1, updated: 0 });
    await expect(uploads.enqueue(preview.previewToken, owner, "all", "WORKBOOK")).rejects.toThrow("변경");
    const [rows] = await harness.pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM audit_log WHERE event_type = 'CANDIDATE_WORKBOOK_IMPORTED'",
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it("imports photo files from the parser manifest without a second ZIP upload", async () => {
    const content = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(content);
    content.writeUInt32BE(13, 8);
    content.write("IHDR", 12);
    content.writeUInt32BE(2, 16);
    content.writeUInt32BE(2, 20);
    const zip = new AdmZip();
    zip.addFile("1162001.png", content);
    const path = join(directory, "photos.zip");
    await writeFile(path, zip.toBuffer());
    const preview = await uploads.preview(
      { path, originalname: "photos.zip", mimetype: "application/zip", size: (await stat(path)).size },
      "PHOTO_ARCHIVE",
      owner,
    );
    const job = await uploads.enqueue(preview.previewToken, owner, "insert-update", "PHOTO_ARCHIVE");
    expect((await completed(job.jobId)).result).toMatchObject({ uploaded: 1 });
    const [rows] = await harness.pool.query<RowDataPacket[]>(
      "SELECT OCTET_LENGTH(content) AS bytes FROM candidate_photo",
    );
    expect(Number(rows[0].bytes)).toBe(content.length);
  });

  it("keeps a finished export available after reconnect and denies another owner", async () => {
    const job = await uploads.startExport(undefined, owner);
    expect((await completed(job.jobId)).result).toEqual({ downloadReady: true });
    await expect(uploads.downloadExport(job.jobId, owner + 99999)).rejects.toThrow("접근");
    for (let attempt = 0; attempt < 2; attempt++) {
      const stream = await uploads.downloadExport(job.jobId, owner);
      let bytes = 0;
      for await (const chunk of stream) bytes += Buffer.byteLength(chunk);
      expect(bytes).toBeGreaterThan(1000);
    }
  });

  it("marks interrupted work failed on restart without replaying it", async () => {
    const id = randomUUID();
    const repository = new CandidateUploadRepository();
    await repository.insert(harness.pool, {
      id,
      owner,
      kind: "WORKBOOK",
      fileName: "interrupted.xlsx",
      checksum: "a".repeat(64),
    });
    await uploads.onModuleDestroy();
    await uploads.onModuleInit();
    expect(await uploads.status(id, owner)).toMatchObject({
      status: "FAILED",
      error: expect.stringContaining("재시작"),
    });
  });

  async function completed(id: string) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const job = await uploads.status(id, owner);
      if (job.status === "FAILED") throw new Error(job.error ?? "Job failed");
      if (job.status === "SUCCEEDED") return job;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Job timed out");
  }
});
