import { randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { Pool } from "mysql2/promise";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { assertAdmissionAccess } from "../authorization/admission-policy.js";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { isDuplicateEntryError as isDuplicateEntry } from "../common/database/mysql-errors.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import { renderZplTemplate } from "../labels/template-renderer.js";
import { assertMatchingPrintJobRequest, createPrintJobRequestFingerprint } from "./print-job-idempotency.js";
import type { CompletePrintJobDto, CreatePrintJobDto } from "./print-jobs.dto.js";
import { PrintJobsRepository } from "./print-jobs.repository.js";

export { resolvePrintJobExpirySeconds } from "../config/print-job-config.js";

@Injectable()
export class PrintJobsService {
  private readonly expirySeconds: number;
  private readonly repository: PrintJobsRepository;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) config: Readonly<AppConfig>,
    @Inject(MutationAuditRepository)
    private readonly audit: MutationAuditRepository = new MutationAuditRepository(),
    @Optional() @Inject(PrintJobsRepository) repository?: PrintJobsRepository,
  ) {
    this.expirySeconds = config.printJobs.expirySeconds;
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
}
