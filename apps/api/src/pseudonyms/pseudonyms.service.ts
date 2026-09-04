import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { Pool } from "mysql2/promise";
import { verifyPassword } from "../auth/password.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import {
  ADMISSION_SQL_COLUMNS,
  assertAdmissionAccess,
  buildAdmissionAccessPredicate,
} from "../authorization/admission-policy.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { withTransaction } from "../common/database/transaction.js";
import { operationStatusResponse, settingResponse } from "./pseudonym-domain.js";
import {
  AssignPseudonymUseCase,
  ChangePseudonymOperationStatusUseCase,
  UpdatePseudonymSettingUseCase,
} from "./pseudonyms.application.js";
import { PseudonymRosterExporter } from "./pseudonym-roster-exporter.js";
import { applyOperationRosterQuery, PSEUDONYM_ROSTER_EXPORT_MAX_ROWS } from "./pseudonym-roster-query.js";
import { PseudonymsRepository } from "./pseudonyms.repository.js";
import type {
  AssignPseudonymDto,
  DeleteAdmissionDto,
  ExportPseudonymRosterDto,
  PseudonymOperationScopeDto,
  ResetAdmissionOperationsDto,
  UpdatePseudonymSettingDto,
} from "./pseudonyms.dto.js";

export type { CandidateScopeSnapshot, ExistingAssignmentScope, RangeCursorSnapshot } from "./pseudonym-domain.js";
export type { SettingRow } from "./pseudonyms.repository.js";
export { ensureAndLockOperation, type OperationLockGateway } from "./pseudonyms.application.js";
export {
  assertAssignmentMethod,
  assertCandidateScopeStable,
  assertExistingAssignmentsWithinProposedRanges,
  assertExpectedSettingVersion,
  assertScheduleRangeCapacities,
  chooseRandomAvailable,
  chooseSequentialAvailable,
  hasRangeConfigurationChanged,
  preserveNextSequence,
} from "./pseudonym-domain.js";

@Injectable()
export class PseudonymsService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(PseudonymsRepository) private readonly repository: PseudonymsRepository = new PseudonymsRepository(),
    @Inject(PseudonymRosterExporter)
    private readonly rosterExporter: PseudonymRosterExporter = new PseudonymRosterExporter(),
    @Inject(AssignPseudonymUseCase)
    private readonly assignPseudonym: AssignPseudonymUseCase = new AssignPseudonymUseCase(pool, repository),
    @Inject(ChangePseudonymOperationStatusUseCase)
    private readonly changeOperationStatus: ChangePseudonymOperationStatusUseCase = new ChangePseudonymOperationStatusUseCase(
      pool,
      repository,
    ),
    @Inject(UpdatePseudonymSettingUseCase)
    private readonly updatePseudonymSetting: UpdatePseudonymSettingUseCase = new UpdatePseudonymSettingUseCase(
      pool,
      repository,
    ),
    @Inject(MutationAuditRepository)
    private readonly audit: MutationAuditRepository = new MutationAuditRepository(),
  ) {}

  async buildOperationRosterExport(input: ExportPseudonymRosterDto, user: AuthenticatedUser) {
    const admissionName = assertAdmissionAccess(user, input.admissionName, {
      forbiddenMessage: "배정되지 않은 전형의 가번호 등록 현황은 다운로드할 수 없습니다.",
    });
    const rows = await this.repository.listOperationRoster(
      this.pool,
      { ...input, examName: input.examName.trim(), admissionName },
      input.query.filters,
    );
    if (rows.length > PSEUDONYM_ROSTER_EXPORT_MAX_ROWS) {
      throw new BadRequestException(
        `엑셀 다운로드는 최대 ${PSEUDONYM_ROSTER_EXPORT_MAX_ROWS.toLocaleString()}건까지 가능합니다. 필터 조건을 추가해 주세요.`,
      );
    }
    const setting = await this.repository.findSetting(this.pool, input.examName.trim(), admissionName, {
      forUpdate: false,
    });
    const labelPrintingEnabled = setting?.assignmentMethod === "PREASSIGNED" && Boolean(setting.printPreassignedLabel);
    return this.rosterExporter.build(applyOperationRosterQuery(rows, input.query), { labelPrintingEnabled });
  }

  async getSetting(examName: string, admissionName: string, user: AuthenticatedUser) {
    if (!admissionName?.trim()) throw new BadRequestException("설정할 전형명을 선택해 주세요.");
    admissionName = assertAdmissionAccess(user, admissionName, {
      forbiddenMessage: "배정되지 않은 전형의 설정은 조회할 수 없습니다.",
    });
    const setting = await this.repository.findSetting(this.pool, examName, admissionName.trim(), { forUpdate: false });
    if (!setting) throw new NotFoundException("이 시험의 가번호 범위가 설정되지 않았습니다.");
    const ranges = await this.repository.listTimeRanges(this.pool, setting.id, admissionName.trim());
    return settingResponse(setting, ranges, admissionName.trim());
  }

  async getSettingsOverview(examName: string, user: AuthenticatedUser) {
    examName = examName.trim();
    if (!examName) throw new BadRequestException("시험명을 확인해 주세요.");
    const access = buildAdmissionAccessPredicate(user, ADMISSION_SQL_COLUMNS.candidateRecord);
    const admissions = await this.repository.listAdmissionSettingsOverview(this.pool, access);
    if (!admissions.length) return [];

    const admissionNames = admissions.map((admission) => admission.name);
    const settings = await this.repository.listSettingsForOverview(this.pool, examName, admissionNames);
    const settingByAdmission = new Map(settings.map((setting) => [setting.admissionName, setting]));
    const fallbackSetting = settingByAdmission.get("");
    const selectedSettings = admissions.map((admission) => settingByAdmission.get(admission.name) ?? fallbackSetting);
    const settingIds = selectedSettings.flatMap((setting) => (setting ? [setting.id] : []));
    const ranges = await this.repository.listTimeRangesForOverview(this.pool, settingIds, admissionNames);
    const rangesBySettingAndAdmission = new Map<string, typeof ranges>();
    for (const range of ranges) {
      const key = overviewRangeKey(range.settingId, range.admission);
      const current = rangesBySettingAndAdmission.get(key) ?? [];
      current.push(range);
      rangesBySettingAndAdmission.set(key, current);
    }

    return admissions.map((admission, index) => {
      const setting = selectedSettings[index];
      if (!setting) return { ...admission, setting: null, error: true };
      const settingRanges = rangesBySettingAndAdmission.get(overviewRangeKey(setting.id, admission.name)) ?? [];
      return {
        ...admission,
        setting: settingResponse(setting, settingRanges, admission.name),
        error: false,
      };
    });
  }

  updateSetting(input: UpdatePseudonymSettingDto, user: AuthenticatedUser) {
    return this.updatePseudonymSetting.execute(input, user);
  }

  async getAdmissionOperationSchedules(examName: string, admissionName: string, user: AuthenticatedUser) {
    examName = examName.trim();
    if (!examName) throw new BadRequestException("시험명을 확인해 주세요.");
    admissionName = assertAdmissionAccess(user, admissionName, {
      forbiddenMessage: "배정되지 않은 전형의 교시 목록은 조회할 수 없습니다.",
    });
    return this.repository.listAdmissionOperationSchedules(this.pool, examName, admissionName);
  }

  async resetAdmissionOperations(input: ResetAdmissionOperationsDto, user: AuthenticatedUser) {
    const examName = input.examName.trim();
    if (!examName) throw new BadRequestException("시험명을 확인해 주세요.");
    const admissionName = assertAdmissionAccess(user, input.admissionName, {
      forbiddenMessage: "배정되지 않은 전형의 운영 이력은 초기화할 수 없습니다.",
    });
    const schedules = uniqueSchedules(input.schedules);

    return withTransaction(this.pool, async (connection) => {
      const availableSchedules = await this.repository.listAdmissionOperationSchedules(
        connection,
        examName,
        admissionName,
      );
      const availableKeys = new Set(availableSchedules.map(scheduleSelectionKey));
      if (schedules.some((schedule) => !availableKeys.has(scheduleSelectionKey(schedule)))) {
        throw new NotFoundException(
          "선택한 교시 중 현재 전형에 존재하지 않는 항목이 있습니다. 목록을 새로고침해 주세요.",
        );
      }

      const deletedAssignmentCount = await this.repository.deleteScheduleAssignments(
        connection,
        examName,
        admissionName,
        schedules,
      );
      const deletedOperationCount = await this.repository.deleteScheduleOperations(
        connection,
        examName,
        admissionName,
        schedules,
      );
      const resetRangeCount = await this.repository.resetScheduleRangeSequences(
        connection,
        examName,
        admissionName,
        schedules,
        user.id,
      );
      const result = {
        resetScheduleCount: schedules.length,
        deletedAssignmentCount,
        deletedOperationCount,
        resetRangeCount,
      };
      await this.audit.record(connection, {
        eventType: "PSEUDONYM_OPERATIONS_RESET",
        actorUserId: user.id,
        details: {
          admissionName,
          scheduleCount: schedules.length,
          deletedAssignmentCount,
          deletedOperationCount,
          resetRangeCount,
        },
      });
      return result;
    });
  }

  async deleteAdmission(input: DeleteAdmissionDto, user: AuthenticatedUser) {
    const admissionName = assertAdmissionAccess(user, input.admissionName, {
      forbiddenMessage: "배정되지 않은 전형은 삭제할 수 없습니다.",
    });

    return withTransaction(this.pool, async (connection) => {
      const passwordHash = await this.repository.findUserPasswordForUpdate(connection, user.id);
      if (passwordHash === undefined) throw new NotFoundException("현재 로그인한 계정을 찾을 수 없습니다.");
      if (!passwordHash || !(await verifyPassword(input.currentPassword, passwordHash))) {
        throw new UnauthorizedException("현재 비밀번호가 올바르지 않습니다.");
      }

      const candidateIds = await this.repository.lockAdmissionCandidateIds(connection, admissionName);
      if (!candidateIds.length) throw new NotFoundException("삭제할 전형을 찾을 수 없습니다.");

      const deletedAssignmentCount = await this.repository.deleteAdmissionAssignments(connection, admissionName);
      const deletedOperationCount = await this.repository.deleteAdmissionOperations(connection, admissionName);
      const deletedRangeCount = await this.repository.deleteAdmissionTimeRanges(connection, admissionName);
      const deletedSettingCount = await this.repository.deleteAdmissionSettings(connection, admissionName);
      const deletedAccountAssignmentCount = await this.repository.deleteUserAdmissionAssignments(
        connection,
        admissionName,
      );
      const deletedCandidateCount = await this.repository.deleteAdmissionCandidates(connection, admissionName);
      const result = {
        deleted: true as const,
        admissionName,
        deletedCandidateCount,
        deletedAssignmentCount,
        deletedOperationCount,
        deletedSettingCount,
        deletedRangeCount,
        deletedAccountAssignmentCount,
      };
      await this.audit.record(connection, {
        eventType: "ADMISSION_DELETED",
        actorUserId: user.id,
        details: {
          admissionName,
          deletedCandidateCount,
          deletedAssignmentCount,
          deletedOperationCount,
          deletedSettingCount,
          deletedRangeCount,
          deletedAccountAssignmentCount,
        },
      });
      return result;
    });
  }

  async getOperationStatus(input: PseudonymOperationScopeDto, user: AuthenticatedUser) {
    const admissionName = assertAdmissionAccess(user, input.admissionName, {
      forbiddenMessage: "배정되지 않은 전형의 운영 상태는 조회할 수 없습니다.",
    });
    input = { ...input, admissionName };
    const status = await this.repository.findOperationStatus(this.pool, input);
    const autoAssignedAbsenteeCount = await this.repository.countAutoAssignedAbsentees(this.pool, input);
    return operationStatusResponse(status, autoAssignedAbsenteeCount);
  }

  closeOperation(input: PseudonymOperationScopeDto, user: AuthenticatedUser) {
    return this.changeOperationStatus.close(input, user);
  }

  reopenOperation(input: PseudonymOperationScopeDto, user: AuthenticatedUser) {
    return this.changeOperationStatus.reopen(input, user);
  }

  assign(input: AssignPseudonymDto, user: AuthenticatedUser) {
    return this.assignPseudonym.execute(input, user);
  }
}

function overviewRangeKey(settingId: number, admissionName: string) {
  return `${settingId}\u0000${admissionName}`;
}

function scheduleSelectionKey(schedule: { examDate: string; examTime: string; periodName: string }) {
  return `${schedule.examDate}\u0000${schedule.examTime}\u0000${schedule.periodName.trim()}`;
}

function uniqueSchedules(schedules: ResetAdmissionOperationsDto["schedules"]) {
  return [
    ...new Map(
      schedules.map((schedule) => {
        const normalized = { ...schedule, periodName: schedule.periodName.trim() };
        return [scheduleSelectionKey(normalized), normalized] as const;
      }),
    ).values(),
  ];
}
