import { randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { Pool } from "mysql2/promise";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { assertAdmissionAccess, normalizeAdmissionName } from "../authorization/admission-policy.js";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { isDuplicateEntryError as isDuplicateEntry } from "../common/database/mysql-errors.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import { IdentityBackfillProjectionRepository } from "../database/identity-backfill-projection.repository.js";
import {
  IdentityTransitionCoordinator,
  type IdentityWriteDecision,
} from "../identity-transition/identity-transition-coordinator.js";
import { renderZplTemplate } from "../labels/template-renderer.js";
import {
  assertMatchingPrintJobRequest,
  createPrintJobReissueRequestFingerprint,
  createPrintJobRequestFingerprint,
} from "./print-job-idempotency.js";
import {
  PRINT_JOB_REPRINT_REASON_CODES,
  PRINT_JOB_RETRY_REASON_CODES,
  type CompletePrintJobDto,
  type CreatePrintJobDto,
  type ReissuePrintJobDto,
} from "./print-jobs.dto.js";
import { PrintJobsRepository, type PrintJobReissueType, type PrintJobStatus } from "./print-jobs.repository.js";

export { resolvePrintJobExpirySeconds } from "../config/print-job-config.js";

@Injectable()
export class PrintJobsService {
  private readonly expirySeconds: number;
  private readonly identityTransitionEnabled: boolean;
  private readonly repository: PrintJobsRepository;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) config: Readonly<AppConfig>,
    @Inject(MutationAuditRepository)
    private readonly audit: MutationAuditRepository = new MutationAuditRepository(),
    @Optional() @Inject(PrintJobsRepository) repository?: PrintJobsRepository,
    @Inject(IdentityBackfillProjectionRepository)
    private readonly identityProjection: IdentityBackfillProjectionRepository = new IdentityBackfillProjectionRepository(),
    @Inject(IdentityTransitionCoordinator)
    private readonly identityTransition: IdentityTransitionCoordinator = createDisabledIdentityTransitionCoordinator(),
  ) {
    this.expirySeconds = config.printJobs.expirySeconds;
    this.identityTransitionEnabled = config.identityTransition.enabled;
    this.repository = repository ?? new PrintJobsRepository();
  }

  async create(input: CreatePrintJobDto, user: AuthenticatedUser) {
    const admissionName = assertAdmissionAccess(user, input.admissionName, {
      forbiddenMessage: "배정되지 않은 전형의 라벨은 출력할 수 없습니다.",
    });
    const idempotencyKey = input.idempotencyKey.toLowerCase();
    const requestFingerprint = createPrintJobRequestFingerprint(input);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const identityDecision = await this.identityTransition.decideWrite(connection);
      if (!identityDecision.writeLegacy) {
        throw new ConflictException("레거시 출력 생성이 허용된 전환 상태에서만 출력 작업을 생성할 수 있습니다.");
      }
      const examName = await this.repository.findAssignedExamName(connection, {
        examineeNo: input.examineeNo.trim(),
        examDate: input.examDate,
        examTime: input.examTime,
        periodName: input.periodName,
        admissionName: input.admissionName.trim(),
      });
      if (examName === null) throw new NotFoundException("가번호가 부여된 수험생을 찾을 수 없습니다.");
      const printPolicy = await this.repository.findPrintPolicyForUpdate(connection, examName, admissionName);
      if (printPolicy?.assignmentMethod !== "PREASSIGNED" || !printPolicy.printPreassignedLabel) {
        throw new ForbiddenException("사전부여 방식에서 라벨 출력 사용이 설정된 전형만 라벨을 출력할 수 있습니다.");
      }
      const existingJob = await this.repository.findByIdempotencyKey(connection, user.id, idempotencyKey);
      if (existingJob) {
        assertMatchingPrintJobRequest(existingJob.requestFingerprint, requestFingerprint);
        await connection.commit();
        return existingJob.response;
      }

      const candidate = await this.repository.findCandidateForUpdate(connection, {
        examineeNo: input.examineeNo.trim(),
        examDate: input.examDate,
        examTime: input.examTime,
        periodName: input.periodName,
        admissionName,
      });
      if (!candidate) throw new NotFoundException("가번호가 부여된 수험생을 찾을 수 없습니다.");

      const template = await this.repository.findActiveLabelTemplate(connection);
      if (!template) throw new NotFoundException("활성 가번호 라벨 템플릿이 없습니다.");

      const workstationId = await this.repository.findEnabledWorkstationId(connection, input.workstationCode);
      if (workstationId === null) throw new NotFoundException("등록된 출력 워크스테이션을 찾을 수 없습니다.");

      const payload = renderZplTemplate(template.zplTemplate, {
        PSEUDONYM_NO: candidate.pseudonymNumber,
        EXAMINEE_NO: candidate.examineeNo,
        ROOM_NAME: candidate.roomName,
        SEAT_NO: candidate.seatNo,
        BARCODE: candidate.labelBarcode,
        EXAM_DATE: candidate.examDate,
      });
      const id = randomUUID();
      const jobNo = `PJ-${Date.now()}-${id.slice(0, 8).toUpperCase()}`;

      await this.repository.insertPrintJob(connection, {
        id,
        jobNo,
        businessReference: candidate.examineeNo,
        templateId: template.id,
        templateVersion: template.version,
        workstationId,
        requestedBy: user.id,
        idempotencyKey,
        requestFingerprint,
        copies: input.copies,
        expirySeconds: this.expirySeconds,
      });
      await this.repository.insertPayload(connection, id, payload);
      if (identityDecision.writeTarget) {
        await this.identityProjection.syncPrintSnapshot(connection, id, candidate.candidateRecordId);
      }
      await this.audit.record(connection, {
        eventType: "PRINT_JOB_CREATED",
        actorUserId: user.id,
        workstationId,
        printJobId: id,
        details: { jobNo, copies: input.copies },
      });
      await connection.commit();
      return { id, jobNo, status: "READY", copies: input.copies, format: "ZPL", payload };
    } catch (error) {
      await connection.rollback();
      if (isDuplicateEntry(error)) {
        const existingJob = await this.repository.findByIdempotencyKey(connection, user.id, idempotencyKey);
        if (existingJob) {
          assertMatchingPrintJobRequest(existingJob.requestFingerprint, requestFingerprint);
          return existingJob.response;
        }
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async complete(id: string, input: CompletePrintJobDto, user: AuthenticatedUser) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.identityTransition.decideWrite(connection);
      const job = await this.repository.findJobForUpdate(connection, id);
      if (!job) throw new NotFoundException("출력 작업을 찾을 수 없습니다.");
      if (user.role !== "ADMIN" && user.role !== "DEVELOPER" && job.requestedBy !== user.id) {
        throw new ForbiddenException("이 출력 작업을 변경할 수 없습니다.");
      }
      if (job.status !== "READY") {
        await connection.commit();
        return { id, status: job.status };
      }
      if (job.workstationId === null) {
        throw new ConflictException("출력 작업에 연결된 워크스테이션 정보가 없습니다.");
      }

      if (job.isExpired === 1) {
        await this.repository.markExpired(connection, id);
        await this.audit.record(connection, {
          eventType: "PRINT_JOB_EXPIRED",
          actorUserId: user.id,
          workstationId: job.workstationId,
          printJobId: id,
          details: { requestedStatus: input.status, status: "EXPIRED" },
        });
        await connection.commit();
        return { id, status: "EXPIRED" };
      }

      if (input.status === "SENT") {
        await this.repository.markSent(connection, id);
      } else {
        await this.repository.markFailed(connection, id, input.errorMessage ?? "프린터 전송 실패");
      }
      if (input.status === "SENT") {
        await this.audit.record(connection, {
          eventType: "PRINT_JOB_SENT",
          actorUserId: user.id,
          workstationId: job.workstationId,
          printJobId: id,
          details: { status: "SENT" },
        });
      } else {
        await this.audit.record(connection, {
          eventType: "PRINT_JOB_FAILED",
          actorUserId: user.id,
          workstationId: job.workstationId,
          printJobId: id,
          details: { status: "FAILED", errorRecorded: true },
        });
      }
      await connection.commit();
      return { id, status: input.status };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async reissue(sourcePrintJobId: string, input: ReissuePrintJobDto, user: AuthenticatedUser) {
    if (!this.identityTransitionEnabled) {
      throw new ConflictException("대상 신원 전환이 활성화된 환경에서만 출력 작업을 재발행할 수 있습니다.");
    }
    const idempotencyKey = input.idempotencyKey.toLowerCase();
    const requestFingerprint = createPrintJobReissueRequestFingerprint(sourcePrintJobId, input);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const identityDecision = await this.identityTransition.decideWrite(connection);
      if (!identityDecision.writeTarget) {
        throw new ConflictException("대상 신원 쓰기가 활성화된 상태에서만 출력 작업을 재발행할 수 있습니다.");
      }
      const source = await this.repository.findReissueSourceForUpdate(connection, sourcePrintJobId);
      if (!source) throw new NotFoundException("출력 작업을 찾을 수 없습니다.");
      if (source.workstationId === null) {
        throw new ConflictException("출력 작업에 연결된 워크스테이션 정보가 없습니다.");
      }
      if (source.hasSnapshot !== 1) {
        throw new ConflictException("불변 출력 snapshot이 없는 레거시 작업은 재발행할 수 없습니다.");
      }
      const reissueType = resolvePrintJobReissueType(source.status);
      assertPrintJobReissueReason(reissueType, input.reasonCode);

      const context = await this.repository.findReissueContextForUpdate(connection, sourcePrintJobId, user.id);
      if (!context) {
        throw new ConflictException("현재 활성 대상·가번호 연결이 없는 출력 작업은 재발행할 수 없습니다.");
      }
      assertPrintJobOwner(source.requestedBy, user.id, context.actorRole);
      if (!context.workstationEnabled) {
        throw new ConflictException("현재 비활성화된 워크스테이션의 출력 작업은 재발행할 수 없습니다.");
      }
      if (context.actorRole !== "ADMIN" && context.actorRole !== "DEVELOPER") {
        const hasTargetAccess =
          context.actorAdmissionScopeMode === "ALL" ||
          (context.actorAdmissionScopeMode === "ASSIGNED" &&
            (await this.repository.hasAdmissionScopeForUpdate(connection, user.id, context.admissionId)));
        if (!hasTargetAccess) {
          throw new ForbiddenException("현재 배정되지 않은 전형의 출력 작업은 재발행할 수 없습니다.");
        }
        if (identityDecision.writeLegacy) {
          const legacyAdmissionNames = await this.repository.listLegacyAdmissionNamesForUpdate(connection, user.id);
          if (
            legacyAdmissionNames.length > 0 &&
            !legacyAdmissionNames.map(normalizeAdmissionName).includes(normalizeAdmissionName(context.admissionName))
          ) {
            throw new ForbiddenException("현재 배정되지 않은 전형의 출력 작업은 재발행할 수 없습니다.");
          }
        }
      }
      const printPolicy = await this.repository.findEffectivePrintPolicyForUpdate(
        connection,
        context.examCycleId,
        context.admissionId,
      );
      if (printPolicy?.assignmentMethod !== "PREASSIGNED" || !printPolicy.printPreassignedLabel) {
        throw new ForbiddenException("현재 사전부여 라벨 출력 정책이 활성화된 전형만 재발행할 수 있습니다.");
      }

      const existingJob = await this.repository.findByIdempotencyKey(connection, user.id, idempotencyKey);
      if (existingJob) {
        assertMatchingPrintJobRequest(existingJob.requestFingerprint, requestFingerprint);
        await connection.commit();
        return existingJob.response;
      }

      const id = randomUUID();
      const jobNo = `PJ-${Date.now()}-${id.slice(0, 8).toUpperCase()}`;
      const record = {
        id,
        jobNo,
        sourcePrintJobId,
        requestedBy: user.id,
        idempotencyKey,
        requestFingerprint,
        expirySeconds: this.expirySeconds,
        reissueType,
        reasonCode: input.reasonCode,
      } as const;
      await this.repository.insertReissuedPrintJob(connection, record);
      await this.repository.insertPayloadFromSnapshot(connection, id, sourcePrintJobId);
      await this.identityProjection.syncPrintSnapshot(connection, id);
      await this.repository.insertReissueEvent(connection, record);
      await this.audit.record(connection, {
        eventType: "PRINT_JOB_REISSUED",
        actorUserId: user.id,
        workstationId: source.workstationId,
        printJobId: id,
        details: { reissueType, reasonCode: input.reasonCode },
      });
      const createdJob = await this.repository.findByIdempotencyKey(connection, user.id, idempotencyKey);
      if (!createdJob) throw new Error("생성된 출력 재발행 작업을 찾을 수 없습니다.");
      await connection.commit();
      return createdJob.response;
    } catch (error) {
      await connection.rollback();
      if (isDuplicateEntry(error)) {
        const existingJob = await this.repository.findByIdempotencyKey(connection, user.id, idempotencyKey);
        if (existingJob) {
          assertMatchingPrintJobRequest(existingJob.requestFingerprint, requestFingerprint);
          return existingJob.response;
        }
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}

function createDisabledIdentityTransitionCoordinator(): IdentityTransitionCoordinator {
  const decision: IdentityWriteDecision = {
    state: {
      enabled: false,
      writeMode: "LEGACY",
      readMode: "LEGACY",
      phase: "EXPANDED",
      version: 0,
      shadowHmacSecret: null,
    },
    writeLegacy: true,
    writeTarget: false,
    authority: "LEGACY",
  };
  return { decideWrite: async () => decision } as unknown as IdentityTransitionCoordinator;
}

function assertPrintJobOwner(requestedBy: number, actorUserId: number, actorRole: AuthenticatedUser["role"]): void {
  if (actorRole !== "ADMIN" && actorRole !== "DEVELOPER" && requestedBy !== actorUserId) {
    throw new ForbiddenException("이 출력 작업을 변경할 수 없습니다.");
  }
}

function resolvePrintJobReissueType(status: PrintJobStatus): PrintJobReissueType {
  if (status === "FAILED" || status === "EXPIRED") return "RETRY";
  if (status === "SENT") return "REPRINT";
  throw new ConflictException("실패·만료·전송 완료 상태의 출력 작업만 재발행할 수 있습니다.");
}

function assertPrintJobReissueReason(reissueType: PrintJobReissueType, reasonCode: string): void {
  const allowed = reissueType === "RETRY" ? PRINT_JOB_RETRY_REASON_CODES : PRINT_JOB_REPRINT_REASON_CODES;
  if (!(allowed as readonly string[]).includes(reasonCode)) {
    throw new ConflictException("출력 작업 상태와 재발행 사유 코드가 일치하지 않습니다.");
  }
}
