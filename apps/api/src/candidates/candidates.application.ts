import { readFile } from "node:fs/promises";
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolConnection } from "mysql2/promise";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { withScopedTransaction } from "../common/database/transaction.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import {
  assertCandidateNumberUniqueness,
  buildCandidateImportPlan,
  buildCandidatePhotoImportPlan,
  hasCandidateOperationalChanges,
  matchCandidatePhotos,
  type CandidatePhotoArchiveFiles,
  type CandidateUploadPolicy,
} from "./candidate-domain.js";
import type { CandidateInput } from "./candidate-fields.js";
import { toCandidateHttpError } from "./candidate-http-errors.js";
import {
  assertCandidatePreviewState,
  candidatePhotoStateChecksum,
  candidateWorkbookStateChecksum,
} from "./candidate-preview-ticket.js";
import { CandidatesRepository, type CandidateImportScopeGuardRow } from "./candidates.repository.js";

@Injectable()
export class CandidatesApplicationService {
  private readonly examName: string;
  private readonly previewSecret: string;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(CandidatesRepository) private readonly repository: CandidatesRepository,
    @Inject(MutationAuditRepository) private readonly audit: MutationAuditRepository,
    @Inject(APP_CONFIG) config: Readonly<AppConfig>,
  ) {
    this.examName = config.candidates.defaultExamName;
    this.previewSecret = config.auth.jwtSecret;
  }

  async importCandidates(
    candidates: readonly CandidateInput[],
    policy: CandidateUploadPolicy,
    checksum: string,
    actorUserId: number | null,
    expectedStateChecksum?: string,
    completion?: (connection: PoolConnection, result: object) => Promise<void>,
    progress?: (processed: number) => Promise<void>,
  ) {
    try {
      const examineeNos = [...new Set(candidates.map((row) => row.examineeNo))];
      const observed = await this.repository.loadExisting(this.pool, { forUpdate: false, examineeNos });
      return await withScopedTransaction(this.pool, async (connection) => {
        const uniqueness = await this.repository.loadExamineeNumberUniqueness(connection, {
          forUpdate: false,
          shared: true,
        });
        await this.repository.lockImportNumbers(connection, examineeNos);
        await this.repository.lockImportAdmissions(connection, this.examName, [...observed.values(), ...candidates]);
        await this.repository.lockImportOperations(connection, this.examName, [...observed.values(), ...candidates]);
        const existing = await this.repository.loadExisting(connection, { forUpdate: true, examineeNos });
        for (const [key, row] of existing) {
          const prior = observed.get(key);
          if (!prior || hasCandidateOperationalChanges(prior, row))
            throw new ConflictException("등록 준비 중 수험생 정보가 변경되었습니다. 미리보기를 다시 확인해 주세요.");
        }
        if (expectedStateChecksum) {
          assertCandidatePreviewState(
            expectedStateChecksum,
            candidateWorkbookStateChecksum(existing.values(), this.previewSecret, uniqueness),
          );
        }
        assertCandidateNumberUniqueness(candidates, existing, uniqueness);
        const plan = buildCandidateImportPlan(candidates, existing, policy);
        const operationalUpdateIds = plan.items.flatMap((item) =>
          item.action === "update" && hasCandidateOperationalChanges(item.current, item.candidate)
            ? [item.current.id]
            : [],
        );
        const protectedIds = await this.repository.listOperationallyProtectedCandidateIds(
          connection,
          operationalUpdateIds,
          this.examName,
        );
        if (protectedIds.size > 0) {
          throw new ConflictException(
            `가번호 배정 또는 마감 이력이 있는 수험생 ${protectedIds.size}명의 전형·모집단위·전공·고사장·사전 가번호 정보는 업로드로 변경할 수 없습니다.`,
          );
        }
        const affectedScopeCandidates = plan.items.flatMap((item) =>
          item.action === "insert"
            ? [item.candidate]
            : item.action === "update" && hasCandidateOperationalChanges(item.current, item.candidate)
              ? [item.current, item.candidate]
              : [],
        );
        if (affectedScopeCandidates.length > 0) {
          const guards = await this.repository.listImportScopeGuards(connection, this.examName);
          assertCandidateImportScopesAreMutable(affectedScopeCandidates, guards);
          await this.repository.deleteTimeRangesByIds(connection, affectedRangeIds(affectedScopeCandidates, guards));
        }

        await this.repository.writeCandidateBatch(
          connection,
          plan.items.flatMap((item) =>
            item.action === "skip"
              ? []
              : [{ candidate: item.candidate, ...(item.action === "update" ? { id: item.current.id } : {}) }],
          ),
          this.examName,
          progress,
        );

        const result = {
          totalRows: plan.totalRows,
          inserted: plan.inserted,
          updated: plan.updated,
          skipped: plan.skipped,
        };
        await this.audit.record(connection, {
          eventType: "CANDIDATE_WORKBOOK_IMPORTED",
          actorUserId,
          details: { ...result, policy, checksum },
        });
        await completion?.(connection, result);
        return result;
      });
    } catch (error) {
      throw toCandidateHttpError(error);
    }
  }

  async importCandidatePhotos(
    archive: CandidatePhotoArchiveFiles,
    policy: CandidateUploadPolicy,
    checksum: string,
    actorUserId: number | null,
    expectedStateChecksum?: string,
    completion?: (connection: PoolConnection, result: object) => Promise<void>,
    progress?: (processed: number) => Promise<void>,
  ) {
    try {
      return await withScopedTransaction(this.pool, async (connection) => {
        const observed = await this.repository.listCandidatePhotos(connection, { forUpdate: false });
        const targetNumbers = matchCandidatePhotos(archive, observed).photos.flatMap((photo) =>
          photo.candidateRows.map((row) => row.examineeNo),
        );
        await this.repository.lockImportNumbers(connection, targetNumbers);
        const candidateRows = await this.repository.listCandidatePhotos(connection, {
          forUpdate: true,
          examineeNos: [...new Set(targetNumbers)],
        });
        if (expectedStateChecksum) {
          assertCandidatePreviewState(
            expectedStateChecksum,
            candidatePhotoStateChecksum(candidateRows, this.previewSecret),
          );
        }
        const matches = matchCandidatePhotos(archive, candidateRows);
        const plan = buildCandidatePhotoImportPlan(matches, policy);

        const packetLimit = (await this.repository.maxPacketBytes(connection)) - 65536;
        const batchLimit = Math.min(packetLimit, 8 * 1024 * 1024);
        let batch: { id: number; fileName: string; mimeType: string; content: Buffer; contentHash: string }[] = [];
        let bytes = 0;
        let processed = 0;
        const flush = async () => {
          await this.repository.upsertCandidatePhotoBatch(connection, batch);
          processed += batch.length;
          await progress?.(processed);
          batch = [];
          bytes = 0;
        };
        for (const item of plan.items) {
          if (item.action === "skip") continue;
          const content = item.photo.contentPath ? await readFile(item.photo.contentPath) : item.photo.content;
          if (content.length + 2048 > packetLimit)
            throw new ConflictException(
              "사진 크기가 DB의 한 번에 저장 가능한 크기를 초과합니다. 사진 크기를 줄여 주세요.",
            );
          for (const candidate of item.photo.candidateRows) {
            if (policy === "insert-only" && candidate.photoHash) continue;
            if (batch.length && (batch.length >= 100 || bytes + content.length + 2048 > batchLimit)) await flush();
            batch.push({ id: candidate.id, ...item.photo, content });
            bytes += content.length + 2048;
          }
        }
        await flush();

        const result = {
          totalFiles: plan.totalFiles,
          uploaded: plan.uploaded,
          updated: plan.updated,
          skipped: plan.skipped,
          duplicateCount: plan.duplicateCount,
        };
        await this.audit.record(connection, {
          eventType: "CANDIDATE_PHOTO_ARCHIVE_IMPORTED",
          actorUserId,
          details: { ...result, policy, checksum },
        });
        await completion?.(connection, result);
        return result;
      });
    } catch (error) {
      throw toCandidateHttpError(error);
    }
  }
}

function assertCandidateImportScopesAreMutable(
  candidates: readonly CandidateInput[],
  guards: readonly CandidateImportScopeGuardRow[],
) {
  const closedConflicts = guards.filter(
    (guard) => guard.guardType === "CLOSED" && candidates.some((candidate) => sameOperation(candidate, guard)),
  ).length;
  if (closedConflicts > 0) {
    throw new ConflictException(
      `등록 완료(마감)된 전형·교시 ${closedConflicts}곳에는 수험생을 추가하거나 운영 정보를 변경할 수 없습니다. 먼저 마감을 해제해 주세요.`,
    );
  }
}

function affectedRangeIds(
  candidates: readonly CandidateInput[],
  guards: readonly CandidateImportScopeGuardRow[],
): number[] {
  return [
    ...new Set(
      guards.flatMap((guard) =>
        guard.guardType === "RANGE" &&
        guard.rangeId !== null &&
        candidates.some((candidate) => sameRangeScope(candidate, guard))
          ? [guard.rangeId]
          : [],
      ),
    ),
  ];
}

function sameRangeScope(candidate: CandidateInput, guard: CandidateImportScopeGuardRow) {
  return (
    sameOperation(candidate, guard) &&
    candidate.unit === guard.unit &&
    candidate.major === guard.major &&
    candidate.building === guard.building &&
    candidate.room === guard.room
  );
}

function sameOperation(candidate: CandidateInput, guard: CandidateImportScopeGuardRow) {
  return (
    candidate.date === guard.date &&
    candidate.time === guard.time &&
    candidate.period === guard.period &&
    candidate.admission === guard.admission
  );
}
