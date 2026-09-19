import { CandidatesService } from "./candidates.service.js";
import { parseCandidateListQuery } from "./candidate-list-query.js";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
  type OnModuleDestroy,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, mkdirSync } from "node:fs";
import { mkdir, open, readFile, readdir, stat, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Pool } from "mysql2/promise";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import { createWorkLimiter } from "../common/bounded-work.js";
import { CandidatesRepository } from "./candidates.repository.js";
import { CandidatesApplicationService } from "./candidates.application.js";
import { CandidateUploadRepository } from "./candidate-upload.repository.js";
import { parseUploadInProcess } from "./candidate-parser-process.js";
import {
  assertCandidateNumberUniqueness,
  assertCandidateUploadPolicy,
  buildCandidatePreview,
  matchCandidatePhotos,
  type CandidatePhotoArchiveFiles,
  type CandidateUploadPolicy,
} from "./candidate-domain.js";
import type { CandidateInput } from "./candidate-fields.js";
import { candidatePhotoStateChecksum, candidateWorkbookStateChecksum } from "./candidate-preview-ticket.js";
import { validatePhotoArchiveUploadFile, validateWorkbookUploadFile } from "./candidate-upload-security.js";
import { toCandidateHttpError } from "./candidate-http-errors.js";

export const incomingUploadDirectory = join(tmpdir(), "examcheck-incoming");
mkdirSync(incomingUploadDirectory, { recursive: true });
export interface DiskCandidateUpload {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}
@Injectable()
export class CandidateUploadService implements OnModuleInit, OnModuleDestroy {
  private readonly root: string;
  private readonly secret: string;
  private readonly exportWork = createWorkLimiter(1, 8);
  private readonly register = createWorkLimiter(1, 20);
  private readonly pending = new Set<Promise<unknown>>();
  private cleanupTimer?: ReturnType<typeof setInterval>;
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) config: Readonly<AppConfig>,
    @Inject(CandidatesRepository) private readonly candidates: CandidatesRepository,
    @Inject(CandidatesApplicationService) private readonly application: CandidatesApplicationService,
    @Inject(CandidateUploadRepository) private readonly repository: CandidateUploadRepository,
    @Inject(CandidatesService) private readonly service: CandidatesService,
  ) {
    this.secret = config.auth.jwtSecret;
    this.root = join(
      tmpdir(),
      "examcheck-uploads-" + createHash("sha256").update(String(config.database.database)).digest("hex").slice(0, 16),
    );
  }
  async onModuleInit() {
    await mkdir(this.root, { recursive: true });
    await this.repository.interrupted(this.pool);
    await this.cleanup();
    this.cleanupTimer = setInterval(() => {
      void this.cleanup().catch(() => {});
    }, 60_000);
    this.cleanupTimer.unref();
  }
  async onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await Promise.allSettled(this.pending);
  }
  private directory(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
      throw new BadRequestException("업로드 작업 번호를 확인해 주세요.");
    return join(this.root, id);
  }
  async preview(file: DiskCandidateUpload | undefined, kind: "WORKBOOK" | "PHOTO_ARCHIVE", owner: number) {
    if (!file) throw new BadRequestException("업로드할 파일을 선택해 주세요.");
    const id = randomUUID();
    const directory = this.directory(id);
    try {
      const handle = await open(file.path, "r");
      const buffer = Buffer.alloc(4);
      try {
        await handle.read(buffer, 0, 4, 0);
      } finally {
        await handle.close();
      }
      const metadata = (kind === "WORKBOOK" ? validateWorkbookUploadFile : validatePhotoArchiveUploadFile)({
        ...file,
        buffer,
      });
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(file.path)) hash.update(chunk);
      const checksum = hash.digest("hex");
      await this.repository.insert(this.pool, { id, owner, kind, fileName: metadata.originalname, checksum });
      await mkdir(directory, { recursive: true });
      const path = join(directory, "upload.bin");
      await rename(file.path, path);
      await parseUploadInProcess(kind, path, directory).catch((error) => {
        throw new BadRequestException(error instanceof Error ? error.message : "파일 분석에 실패했습니다.");
      });
      const parsed = JSON.parse(await readFile(join(directory, "parsed.json"), "utf8"));
      let preview: object;
      let state: string;
      let total: number;
      if (kind === "WORKBOOK") {
        const rows = parsed as CandidateInput[];
        const policy = await this.candidates.loadExamineeNumberUniqueness(this.pool, { forUpdate: false });
        const existing = await this.candidates.loadExisting(this.pool, {
          forUpdate: false,
          examineeNos: [...new Set(rows.map((row) => row.examineeNo))],
        });
        assertCandidateNumberUniqueness(rows, existing, policy);
        preview = buildCandidatePreview(rows, existing);
        total = rows.length;
        state = candidateWorkbookStateChecksum(existing.values(), this.secret, policy);
      } else {
        const archive = parsed as CandidatePhotoArchiveFiles;
        const matches = matchCandidatePhotos(
          archive,
          await this.candidates.listCandidatePhotos(this.pool, { forUpdate: false }),
        );
        preview = {
          totalFiles: matches.totalFiles,
          matchedCount: matches.photos.length,
          skippedCount: matches.skippedCount,
          duplicateCount: matches.duplicateCount,
        };
        total = matches.totalFiles;
        state = candidatePhotoStateChecksum(
          matches.photos.flatMap((photo) => photo.candidateRows),
          this.secret,
        );
      }
      const result = { fileName: metadata.originalname, previewToken: id, ...preview };
      await this.repository.preview(this.pool, id, state, result, total);
      await rm(path, { force: true });
      return result;
    } catch (error) {
      await this.repository
        .failure(this.pool, id, error instanceof Error ? error.message : "파일 분석에 실패했습니다.")
        .catch(() => {});
      await rm(directory, { recursive: true, force: true });
      throw toCandidateHttpError(error);
    } finally {
      await rm(file.path, { force: true });
    }
  }
  async enqueue(id: string, owner: number, policy: CandidateUploadPolicy, kind: "WORKBOOK" | "PHOTO_ARCHIVE") {
    this.directory(id);
    assertCandidateUploadPolicy(policy, kind === "WORKBOOK" ? "workbook" : "photo");
    const session = await this.repository.find(this.pool, id, owner);
    if (!session || session.kind !== kind)
      throw new NotFoundException("업로드 미리보기가 만료되었거나 접근할 수 없습니다.");
    if (session.policy && session.policy !== policy)
      throw new ConflictException("이미 시작한 작업의 처리 방식을 변경할 수 없습니다.");
    if (session.status === "FAILED")
      throw new ConflictException(session.error || "업로드가 중단되었습니다. 미리보기부터 다시 진행해 주세요.");
    if (await this.repository.enqueue(this.pool, id, owner, policy)) {
      const task = this.register(async () => {
        try {
          await this.repository.running(this.pool, id);
          const parsed = JSON.parse(await readFile(join(this.directory(id), "parsed.json"), "utf8"));
          const complete = (connection: import("mysql2/promise").PoolConnection, result: object) =>
            this.repository.success(connection, id, result);
          if (kind === "WORKBOOK")
            await this.application.importCandidates(
              parsed,
              policy,
              session.checksum,
              owner,
              session.stateChecksum,
              complete,
              (processed) => this.repository.progress(this.pool, id, processed),
            );
          else
            await this.application.importCandidatePhotos(
              parsed,
              policy,
              session.checksum,
              owner,
              session.stateChecksum,
              complete,
              (processed) => this.repository.progress(this.pool, id, processed),
            );
        } catch (error) {
          await this.repository.failure(this.pool, id, error instanceof Error ? error.message : "등록에 실패했습니다.");
        } finally {
          await rm(this.directory(id), { recursive: true, force: true });
        }
      }).catch(async (error) => {
        await this.repository.failure(
          this.pool,
          id,
          error instanceof Error ? error.message : "작업을 시작하지 못했습니다.",
        );
      });
      this.pending.add(task);
      void task.then(
        () => this.pending.delete(task),
        () => this.pending.delete(task),
      );
    }
    return { jobId: id };
  }
  async startExport(raw: string | undefined, owner: number) {
    const query = parseCandidateListQuery(raw);
    const id = randomUUID();
    const directory = this.directory(id);
    await mkdir(directory, { recursive: true });
    try {
      await this.repository.insert(this.pool, {
        id,
        owner,
        kind: "CANDIDATE_EXPORT",
        fileName: "수험생 데이터.xlsx",
        checksum: createHash("sha256").update(JSON.stringify(query)).digest("hex"),
      });
      await this.repository.preview(this.pool, id, "", query, 0);
      await this.repository.enqueue(this.pool, id, owner, "export");
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    const task = this.exportWork(async () => {
      try {
        await this.repository.running(this.pool, id);
        await this.service.writeExportFile(JSON.stringify(query), join(directory, "download.xlsx"));
        await this.repository.success(this.pool, id, { downloadReady: true });
      } catch (error) {
        await this.repository.failure(
          this.pool,
          id,
          error instanceof Error ? error.message : "내보내기에 실패했습니다.",
        );
        await rm(directory, { recursive: true, force: true });
      }
    }).catch((error) =>
      this.repository.failure(
        this.pool,
        id,
        error instanceof Error ? error.message : "내보내기를 시작하지 못했습니다.",
      ),
    );
    this.pending.add(task);
    void task.then(
      () => this.pending.delete(task),
      () => this.pending.delete(task),
    );
    return { jobId: id };
  }
  async downloadExport(id: string, owner: number) {
    const directory = this.directory(id);
    const session = await this.repository.find(this.pool, id, owner);
    if (!session || session.kind !== "CANDIDATE_EXPORT")
      throw new NotFoundException("내보내기 파일이 만료되었거나 접근할 수 없습니다.");
    if (session.status !== "SUCCEEDED") throw new ConflictException("파일 준비가 완료되지 않았습니다.");
    const path = join(directory, "download.xlsx");
    if (!(await stat(path).catch(() => null))?.isFile())
      throw new NotFoundException("내보내기 파일이 만료되었습니다. 다시 내려받아 주세요.");
    return createReadStream(path);
  }
  async status(id: string, owner: number) {
    this.directory(id);
    const session = await this.repository.find(this.pool, id, owner);
    if (!session) throw new NotFoundException("업로드 작업이 만료되었거나 접근할 수 없습니다.");
    const result = typeof session.result === "string" ? JSON.parse(session.result) : session.result;
    return {
      jobId: id,
      status: session.status,
      processed: Number(session.processed),
      total: Number(session.total),
      result,
      error: session.error,
    };
  }
  private async cleanup() {
    for (const name of await readdir(incomingUploadDirectory)) {
      if (!/^[a-f0-9]{32}$/.test(name)) continue;
      const path = join(incomingUploadDirectory, name);
      const info = await stat(path).catch(() => null);
      if (info?.isFile() && Date.now() - info.mtimeMs > 60 * 60_000) await rm(path, { force: true });
    }
    for (const id of await this.repository.expired(this.pool)) {
      await rm(this.directory(id), { recursive: true, force: true });
      await this.repository.remove(this.pool, id);
    }
  }
}
