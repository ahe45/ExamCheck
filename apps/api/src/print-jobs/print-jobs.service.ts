import { beginScopedWrite } from "../common/database/transaction.js";
import type { SqlExecutor } from "../common/database/sql-executor.js";
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
import { toLabelTemplateZplValues } from "../label-templates/label-template-layout.js";
import { renderLabelPayload } from "../label-templates/label-payload-renderer.js";
import { assertMatchingPrintJobRequest, createPrintJobRequestFingerprint } from "./print-job-idempotency.js";
import type { CompletePrintJobDto, CreatePrintJobDto } from "./print-jobs.dto.js";
import { PrintJobsRepository } from "./print-jobs.repository.js";

export { resolvePrintJobExpirySeconds } from "../config/print-job-config.js";

@Injectable()
export class PrintJobsService {
  private readonly expirySeconds: number;
  private readonly defaultExamName: string;
  private readonly repository: PrintJobsRepository;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) config: Readonly<AppConfig>,
    @Inject(MutationAuditRepository)
    private readonly audit: MutationAuditRepository = new MutationAuditRepository(),
    @Optional() @Inject(PrintJobsRepository) repository?: PrintJobsRepository,
  ) {
    this.expirySeconds = config.printJobs.expirySeconds;
    this.defaultExamName = config.candidates.defaultExamName;
    this.repository = repository ?? new PrintJobsRepository();
  }

  async create(input: CreatePrintJobDto, user: AuthenticatedUser) {
    const admissionName = assertAdmissionAccess(user, input.admissionName, {
      forbiddenMessage: "배정되지 않은 전형의 라벨은 출력할 수 없습니다.",
    });
    const idempotencyKey = input.idempotencyKey.toLowerCase();
    const requestFingerprint = createPrintJobRequestFingerprint(input);
    const prepared = await this.loadPrintContext(this.pool, input, admissionName, false);
    const { candidate, template, examName, workstationId } = prepared;
    const templateValues = toLabelTemplateZplValues({
      "system.title": candidate.systemName,
      "system.printedAt": new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Seoul",
      }).format(new Date()),
      "school.name": candidate.schoolName,
      "candidate.admissionYear": candidate.academicYear,
      "candidate.examName": candidate.examName || examName,
      "candidate.examDate": candidate.examDate,
      "candidate.examStartTime": candidate.examStartTime,
      "candidate.examEndTime": candidate.examEndTime,
      "candidate.periodName": candidate.periodName,
      "candidate.admissionTypeName": candidate.admissionName,
      "candidate.departmentName": candidate.unitName,
      "candidate.majorName": candidate.majorName,
      "candidate.examNo": candidate.examineeNo,
      "candidate.name": candidate.candidateName,
      "candidate.birthDate": candidate.birthDate,
      "candidate.temporaryNo": candidate.pseudonymNumber,
      "candidate.preassignedNo": candidate.preassignedNumber,
      "candidate.groupName": candidate.groupName,
      "candidate.absent": candidate.absent ? "결시" : "응시",
      "candidate.photo": "",
      "candidate.buildingName": candidate.buildingName,
      "candidate.waitingRoomName": candidate.waitingRoom || "",
      "candidate.roomName": candidate.roomName,
      "candidate.seatNo": candidate.seatNo,
      "candidate.opt1": candidate.opt1,
      "candidate.opt2": candidate.opt2,
      "candidate.opt3": candidate.opt3,
      "candidate.labelBarcode": candidate.labelBarcode,
      "room.assignedCount": candidate.roomAssignedCount,
      "room.presentCount": candidate.roomPresentCount,
      "room.absentCount": candidate.roomAbsentCount,
      "signature.author": "",
      "signature.reviewer": "",
      "row.indexInPage": 1,
    });
    const payload = template.layout
      ? await renderLabelPayload(template.layout, templateValues)
      : renderZplTemplate(template.zplTemplate, templateValues);
    const connection = await this.pool.getConnection();
    try {
      await beginScopedWrite(connection);
      const current = await this.loadPrintContext(connection, input, admissionName, true);
      if (await this.repository.hasPrintedLabel(connection, current.candidate.candidateRecordId)) {
        throw new ConflictException("이미 출력된 수험생은 라벨을 재출력할 수 없습니다.");
      }
      const existingJob = await this.repository.findByIdempotencyKey(connection, user.id, idempotencyKey);
      if (existingJob) {
        assertMatchingPrintJobRequest(existingJob.requestFingerprint, requestFingerprint);
        if (existingJob.response.status !== "READY")
          throw new ConflictException("이미 처리된 출력 작업은 다시 전송할 수 없습니다.");
        await connection.commit();
        return existingJob.response;
      }
      if (JSON.stringify(current) !== JSON.stringify(prepared)) {
        throw new ConflictException("출력 준비 중 수험생 또는 양식 설정이 변경되었습니다. 다시 출력해 주세요.");
      }
      if (await this.repository.hasPendingLabel(connection, candidate.candidateRecordId)) {
        throw new ConflictException("이미 준비 중인 출력 작업이 있습니다. 기존 출력 결과를 확인해 주세요.");
      }
      const id = randomUUID();
      const jobNo = `PJ-${Date.now()}-${id.slice(0, 8).toUpperCase()}`;

      await this.repository.insertPrintJob(connection, {
        id,
        jobNo,
        businessReference: candidate.examineeNo,
        candidateRecordId: candidate.candidateRecordId,
        templateId: template.id,
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
          if (existingJob.response.status !== "READY")
            throw new ConflictException("이미 처리된 출력 작업은 다시 전송할 수 없습니다.");
          return existingJob.response;
        }
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  private async loadPrintContext(
    executor: SqlExecutor,
    input: CreatePrintJobDto,
    admissionName: string,
    locking: boolean,
  ) {
    const scope = {
      examineeNo: input.examineeNo.trim(),
      examDate: input.examDate,
      examTime: input.examTime,
      periodName: input.periodName,
      admissionName,
    };
    const examName = await this.repository.findAssignedExamName(executor, scope, this.defaultExamName);
    if (examName === null) throw new NotFoundException("가번호가 부여된 수험생을 찾을 수 없습니다.");
    const printPolicy = await this.repository.findPrintPolicyForUpdate(executor, examName, admissionName, locking);
    if (printPolicy?.assignmentMethod !== "PREASSIGNED" || !printPolicy.printPreassignedLabel)
      throw new ForbiddenException("사전부여 방식에서 라벨 출력 사용이 설정된 전형만 라벨을 출력할 수 있습니다.");
    const candidate = await this.repository.findCandidateForUpdate(executor, scope, locking);
    if (!candidate) throw new NotFoundException("가번호가 부여된 수험생을 찾을 수 없습니다.");
    const template = await this.repository.findActiveLabelTemplate(executor, printPolicy.labelTemplateId, locking);
    if (!template) throw new NotFoundException("이 전형에 사용할 수 있는 라벨 양식이 없습니다.");
    if (
      /room\.(assignedCount|presentCount|absentCount)|ROOM_(ASSIGNED|PRESENT|ABSENT)_COUNT/.test(
        JSON.stringify(template.layout ?? template.zplTemplate),
      )
    ) {
      Object.assign(candidate, await this.repository.roomCounts(executor, candidate));
    }
    const workstationId = await this.repository.findEnabledWorkstationId(executor, input.workstationCode);
    if (workstationId === null) throw new NotFoundException("등록된 출력 워크스테이션을 찾을 수 없습니다.");
    return { examName, printPolicy, candidate, template, workstationId };
  }

  async complete(id: string, input: CompletePrintJobDto, user: AuthenticatedUser) {
    const connection = await this.pool.getConnection();
    try {
      await beginScopedWrite(connection);
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
