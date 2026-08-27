import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { Pool } from "mysql2/promise";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { withTransaction } from "../common/database/transaction.js";
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
  ) {
    try {
      return await withTransaction(this.pool, async (connection) => {
        const uniqueness = await this.repository.loadExamineeNumberUniqueness(connection, { forUpdate: true });
        const existing = await this.repository.loadExisting(connection, { forUpdate: true });
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
            `가번호 범위 설정 또는 운영 이력이 있는 수험생 ${protectedIds.size}명의 전형·모집단위·전공·고사장·사전 가번호 정보는 업로드로 변경할 수 없습니다.`,
          );
        }
        const scopeChangingCandidates = plan.items.flatMap((item) =>
          item.action === "insert"
            ? [item.candidate]
            : item.action === "update" && hasCandidateOperationalChanges(item.current, item.candidate)
              ? [item.candidate]
              : [],
        );
        if (scopeChangingCandidates.length > 0) {
          const guards = await this.repository.listImportScopeGuards(connection, this.examName);
          assertCandidateImportScopesAreMutable(scopeChangingCandidates, guards);
        }

        for (const item of plan.items) {
          if (item.action === "skip") continue;
          if (item.action === "update") {
            await this.repository.updateCandidate(connection, item.current.id, item.candidate);
          } else {
            await this.repository.insertCandidate(connection, item.candidate);
          }
          await this.repository.syncOperationalExaminee(connection, item.candidate, this.examName);
        }

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
  ) {
    try {
      return await withTransaction(this.pool, async (connection) => {
        const candidateRows = await this.repository.listCandidatePhotos(connection, { forUpdate: true });
        if (expectedStateChecksum) {
          assertCandidatePreviewState(
            expectedStateChecksum,
            candidatePhotoStateChecksum(candidateRows, this.previewSecret),
          );
        }
        const matches = matchCandidatePhotos(archive, candidateRows);
        const plan = buildCandidatePhotoImportPlan(matches, policy);

        for (const item of plan.items) {
          if (item.action === "skip") continue;
          for (const candidate of item.photo.candidateRows) {
            if (policy === "insert-only" && candidate.photoHash) continue;
            await this.repository.upsertCandidatePhoto(connection, candidate.id, item.photo);
          }
        }

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

  const rangeConflicts = guards.filter(
    (guard) =>
      guard.guardType === "RANGE" &&
      candidates.some(
        (candidate) =>
          sameOperation(candidate, guard) &&
          candidate.unit === guard.unit &&
          candidate.major === guard.major &&
          candidate.building === guard.building &&
          candidate.room === guard.room,
      ),
  ).length;
  if (rangeConflicts > 0) {
    throw new ConflictException(
      `가번호 범위가 설정된 일정 ${rangeConflicts}곳의 배정인원을 업로드로 변경할 수 없습니다. 해당 전형의 운영 설정을 먼저 정리해 주세요.`,
    );
  }
}

function sameOperation(candidate: CandidateInput, guard: CandidateImportScopeGuardRow) {
  return (
    candidate.date === guard.date &&
    candidate.time === guard.time &&
    candidate.period === guard.period &&
    candidate.admission === guard.admission
  );
}
