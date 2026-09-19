import { beginScopedWrite } from "../common/database/transaction.js";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Pool, PoolConnection } from "mysql2/promise";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { assertAdmissionAccess, normalizeAdmissionName } from "../authorization/admission-policy.js";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import {
  isConcurrentWriteError as isConcurrentSettingWriteError,
  isDuplicateEntryError,
} from "../common/database/mysql-errors.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import { IdentityBackfillProjectionRepository } from "../database/identity-backfill-projection.repository.js";
import { displayPseudonymNumber } from "../identity-transition/identity-keys.js";
import { IdentityTransitionCoordinator } from "../identity-transition/identity-transition-coordinator.js";
import { pseudonymUniquenessScopeKey } from "../uniqueness/number-uniqueness.js";
import {
  assignmentModeForSetting,
  assignmentResponse,
  assertAssignmentMethod,
  assertCandidateScopeStable,
  assertExistingAssignmentsWithinProposedRanges,
  assertExpectedSettingVersion,
  assertScheduleRangeCapacities,
  assertWithinRange,
  candidatePseudonymScope,
  chooseRandomAvailable,
  chooseSequentialAvailable,
  hasRangeConfigurationChanged,
  operationPseudonymScope,
  operationStatusResponse,
  parsePseudonym,
  preserveNextSequence,
  scheduleIdentity,
  scheduleKey,
  settingResponse,
  settingVersionConflict,
} from "./pseudonym-domain.js";
import { toPseudonymHttpError } from "./pseudonym-http-errors.js";
import { PseudonymsRepository, type OperationLockRow, type SettingRow } from "./pseudonyms.repository.js";
import type {
  AssignPseudonymInput,
  PseudonymOperationScopeInput,
  UpdatePseudonymSettingInput,
} from "./pseudonyms.types.js";

export interface OperationLockGateway {
  ensure(params: string[]): Promise<void>;
  lock(params: string[]): Promise<OperationLockRow | undefined>;
}

@Injectable()
export class UpdatePseudonymSettingUseCase {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(PseudonymsRepository) private readonly repository: PseudonymsRepository,
    @Inject(MutationAuditRepository)
    private readonly audit: MutationAuditRepository = new MutationAuditRepository(),
    @Inject(IdentityTransitionCoordinator)
    private readonly identityTransition: IdentityTransitionCoordinator = legacyIdentityTransitionCoordinator(),
    @Inject(IdentityBackfillProjectionRepository)
    private readonly identityProjection: IdentityBackfillProjectionRepository = new IdentityBackfillProjectionRepository(),
  ) {}

  async execute(input: UpdatePseudonymSettingInput, user: AuthenticatedUser) {
    const admissionName = assertAdmissionAccess(user, input.admissionName, {
      forbiddenMessage: "배정되지 않은 전형의 설정은 변경할 수 없습니다.",
    });
    input = {
      ...input,
      admissionName,
      ranges: input.ranges.map((range) => ({
        ...range,
        admission: normalizeAdmissionName(range.admission),
      })),
    };
    if (input.rangeStart > input.rangeEnd) throw new BadRequestException("가번호 시작값은 종료값보다 클 수 없습니다.");
    const scheduleKeys = new Set<string>();
    for (const range of input.ranges) {
      if (range.admission !== input.admissionName)
        throw new BadRequestException("선택한 전형과 다른 가번호 범위가 포함되어 있습니다.");
      if (range.rangeStart > range.rangeEnd)
        throw new BadRequestException(`${range.date} ${range.time}의 시작값은 종료값보다 클 수 없습니다.`);
      const key = scheduleIdentity(range);
      if (scheduleKeys.has(key)) throw new BadRequestException("동일한 시험 조건의 가번호 범위가 중복되었습니다.");
      scheduleKeys.add(key);
    }

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const identityDecision = await this.identityTransition.decideWrite(connection);
      assertLegacyCompatibilityWrite(identityDecision.writeLegacy, "pseudonym settings");
      await this.repository.loadPseudonymNumberPolicyForUpdate(connection);
      const existingSetting = await this.repository.findExactSettingForUpdate(
        connection,
        input.examName,
        input.admissionName,
      );
      assertExpectedSettingVersion(input.expectedVersion, existingSetting?.version ?? 1, !existingSetting);

      const scheduleCounts = await this.repository.listScheduleCounts(connection, input.examName, input.admissionName);
      assertScheduleRangeCapacities(
        input.ranges,
        scheduleCounts,
        input.assignmentMethod === "DRAW" ||
          input.assignmentMethod === "SEQUENTIAL" ||
          input.assignmentMethod === "MATCHING",
      );

      const existingRanges = existingSetting
        ? await this.repository.listTimeRangesForUpdate(connection, existingSetting.id)
        : [];
      if (hasRangeConfigurationChanged(existingSetting, existingRanges, input)) {
        const existingAssignments = await this.repository.listAssignmentScopesForUpdate(
          connection,
          input.examName,
          input.admissionName,
        );
        assertExistingAssignmentsWithinProposedRanges(existingAssignments, input);
      }

      const settingNextSequence = preserveNextSequence(existingSetting?.nextSequence, input.rangeStart, input.rangeEnd);
      let settingId: number;
      if (existingSetting) {
        const affectedRows = await this.repository.updateSetting(
          connection,
          existingSetting.id,
          input.expectedVersion,
          settingNextSequence,
          input,
          user.id,
        );
        if (affectedRows !== 1) throw settingVersionConflict();
        settingId = existingSetting.id;
      } else {
        settingId = await this.repository.insertSetting(connection, settingNextSequence, input, user.id);
        if (!Number.isSafeInteger(settingId) || settingId < 1) {
          throw new NotFoundException("가번호 운영 설정을 저장하지 못했습니다.");
        }
      }

      const existingRangesByKey = new Map(existingRanges.map((range) => [range.scheduleKey, range]));
      const proposedScheduleKeys = new Set<string>();
      for (const range of input.ranges) {
        const key = scheduleKey(range);
        proposedScheduleKeys.add(key);
        const nextSequence = preserveNextSequence(
          existingRangesByKey.get(key)?.nextSequence,
          range.rangeStart,
          range.rangeEnd,
        );
        const prior = existingRangesByKey.get(key);
        if (
          !prior ||
          prior.rangeStart !== range.rangeStart ||
          prior.rangeEnd !== range.rangeEnd ||
          prior.displayWidth !== range.displayWidth ||
          prior.nextSequence !== nextSequence
        ) {
          await this.repository.upsertTimeRange(connection, settingId, range, key, nextSequence, user.id);
        }
      }
      for (const existingRange of existingRanges) {
        if (!proposedScheduleKeys.has(existingRange.scheduleKey)) {
          await this.repository.deleteTimeRange(connection, existingRange.id);
        }
      }
      if (identityDecision.writeTarget) {
        await this.identityProjection.syncSettingTree(connection, settingId, input.examName);
      }
      await this.audit.record(connection, {
        eventType: "PSEUDONYM_SETTING_UPDATED",
        actorUserId: user.id,
        details: {
          settingId,
          version: existingSetting ? existingSetting.version + 1 : 1,
          assignmentMethod: input.assignmentMethod,
          rangeCount: input.ranges.length,
          autoDrawEnabled: input.autoDrawEnabled,
          autoDrawDelaySeconds: input.autoDrawDelaySeconds,
          printPreassignedLabel: input.printPreassignedLabel,
          autoAssignAbsenteesOnClose: input.autoAssignAbsenteesOnClose,
          deleteAbsenteeInfoOnReopen: input.deleteAbsenteeInfoOnReopen,
          useCandidatePhotos: input.useCandidatePhotos,
          enableBulkDraw: input.enableBulkDraw,
        },
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (isConcurrentSettingWriteError(error)) throw toPseudonymHttpError(settingVersionConflict());
      throw toPseudonymHttpError(error);
    } finally {
      connection.release();
    }
    return this.getSetting(input.examName, input.admissionName);
  }

  private async getSetting(examName: string, admissionName: string) {
    const setting = await this.repository.findSetting(this.pool, examName, admissionName, { forUpdate: false });
    if (!setting) throw new NotFoundException("이 시험의 가번호 범위가 설정되지 않았습니다.");
    const ranges = await this.repository.listTimeRanges(this.pool, setting.id, admissionName);
    return settingResponse(setting, ranges, admissionName);
  }
}

@Injectable()
export class AssignPseudonymUseCase {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(PseudonymsRepository) private readonly repository: PseudonymsRepository,
    @Inject(MutationAuditRepository)
    private readonly audit: MutationAuditRepository = new MutationAuditRepository(),
    @Inject(IdentityTransitionCoordinator)
    private readonly identityTransition: IdentityTransitionCoordinator = legacyIdentityTransitionCoordinator(),
    @Inject(IdentityBackfillProjectionRepository)
    private readonly identityProjection: IdentityBackfillProjectionRepository = new IdentityBackfillProjectionRepository(),
  ) {}

  execute(input: AssignPseudonymInput, user: AuthenticatedUser): Promise<ReturnType<typeof assignmentResponse>>;
  execute(input: AssignPseudonymInput, user: AuthenticatedUser, preview: true): Promise<{ pseudonymNumber: string }>;
  async execute(input: AssignPseudonymInput, user: AuthenticatedUser, preview = false) {
    if (preview && input.mode !== "SEQUENTIAL")
      throw new BadRequestException("순차부여에서만 예정 번호를 조회할 수 있습니다.");
    const admissionName = assertAdmissionAccess(user, input.admissionName, {
      forbiddenMessage: "배정되지 않은 전형의 수험생에게 가번호를 부여할 수 없습니다.",
    });
    input = { ...input, admissionName };
    const connection = await this.pool.getConnection();
    try {
      await beginScopedWrite(connection);
      const identityDecision = await this.identityTransition.decideWrite(connection);
      assertLegacyCompatibilityWrite(identityDecision.writeLegacy, "pseudonym assignment");
      const pseudonymNoUniqueness = await this.repository.loadPseudonymNumberPolicyForUpdate(connection, true);
      const identifiedCandidate = await this.repository.findCandidateInScope(connection, input, { forUpdate: false });
      if (!identifiedCandidate) throw new NotFoundException("선택한 전형·교시에 해당하는 수험생을 찾을 수 없습니다.");

      if (pseudonymNoUniqueness === "ADMISSION")
        await this.repository.lockAdmissionNumbers(connection, identifiedCandidate.examName, input.admissionName);
      const operation = await lockOperationForUpdate(this.repository, connection, {
        examName: identifiedCandidate.examName,
        examDate: input.examDate,
        examTime: input.examTime,
        periodName: input.periodName,
        admissionName: input.admissionName,
      });
      if (operation.closed)
        throw new ConflictException("가번호 등록이 마감된 교시입니다. 더 이상 가번호를 부여할 수 없습니다.");

      const setting = await loadSettingForUpdate(
        this.repository,
        connection,
        identifiedCandidate.examName,
        input.admissionName,
        true,
      );
      const timeRanges =
        setting.assignmentMethod === "DRAW" ||
        setting.assignmentMethod === "SEQUENTIAL" ||
        setting.assignmentMethod === "MATCHING"
          ? await this.repository.listTimeRangesForUpdate(connection, setting.id, {
              ...input,
              examName: input.examName || "",
            })
          : [];
      const candidate = await this.repository.findCandidateInScope(connection, input, { forUpdate: true });
      assertCandidateScopeStable(identifiedCandidate, candidate);

      const existingAssignment = await this.repository.findAssignmentForUpdate(connection, candidate.candidateRecordId);
      if (existingAssignment) {
        if (preview) {
          await connection.rollback();
          return { pseudonymNumber: existingAssignment.pseudonymNumber };
        }
        if (identityDecision.writeTarget) {
          await this.identityProjection.syncAssignmentTree(
            connection,
            existingAssignment.id,
            identifiedCandidate.examName,
          );
        }
        await connection.commit();
        return assignmentResponse(candidate, existingAssignment, true);
      }

      assertAssignmentMethod(input.mode, setting.assignmentMethod);
      let effectiveRange: Pick<SettingRow, "rangeStart" | "rangeEnd" | "displayWidth" | "nextSequence"> = setting;
      let timeRangeId: number | null = null;
      if (
        (setting.assignmentMethod === "DRAW" ||
          setting.assignmentMethod === "SEQUENTIAL" ||
          setting.assignmentMethod === "MATCHING") &&
        candidate.examDate &&
        candidate.examTime
      ) {
        const candidateScheduleKey = scheduleKey({
          date: candidate.examDate,
          time: candidate.examTime,
          period: candidate.period || "",
          admission: candidate.admission || "",
          unit: candidate.unit || "",
          major: candidate.major || "",
          building: candidate.building || "",
          room: candidate.room || "",
        });
        const timeRange = timeRanges.find((range) => range.scheduleKey === candidateScheduleKey);
        if (!timeRange)
          throw new NotFoundException(`${candidate.examDate} ${candidate.examTime}의 가번호 범위를 설정해 주세요.`);
        effectiveRange = timeRange;
        timeRangeId = timeRange.id;
      }

      const uniquenessScope = candidatePseudonymScope(candidate);
      const uniquenessScopeKey = pseudonymUniquenessScopeKey(pseudonymNoUniqueness, uniquenessScope);
      const reserved = await this.repository.loadReservedNumbers(
        connection,
        candidate.examName,
        candidate.admission || "",
        pseudonymNoUniqueness,
        uniquenessScope,
        input.manualNumber
          ? { start: parsePseudonym(input.manualNumber), end: parsePseudonym(input.manualNumber) }
          : { start: effectiveRange.rangeStart, end: effectiveRange.rangeEnd },
      );
      let number: number;
      let displayWidth =
        effectiveRange.displayWidth ??
        Math.max(String(effectiveRange.rangeStart).length, String(effectiveRange.rangeEnd).length);
      if (input.mode === "PREASSIGNED") {
        if (!candidate.preassignedNumber) throw new BadRequestException("이 수험생에게 미리 등록된 가번호가 없습니다.");
        number = parsePseudonym(candidate.preassignedNumber);
        displayWidth = candidate.preassignedNumber.length;
      } else if (
        input.mode === "MANUAL" ||
        (!preview && input.mode === "SEQUENTIAL" && input.manualNumber !== undefined)
      ) {
        if (!input.manualNumber) throw new BadRequestException("직접 부여할 가번호를 입력해 주세요.");
        number = parsePseudonym(input.manualNumber);
        displayWidth = input.manualNumber.length;
        assertWithinRange(number, effectiveRange);
        const reservedOwner = await this.repository.findPreassignedOwner(
          connection,
          candidate.examName,
          candidate.admission || "",
          input.manualNumber,
          pseudonymNoUniqueness,
          uniquenessScope,
        );
        if (reserved.has(number) || (reservedOwner && reservedOwner !== candidate.candidateRecordId)) {
          throw new ConflictException("이미 사용 중이거나 다른 수험생에게 예약된 가번호입니다.");
        }
      } else if (input.mode === "RANDOM") {
        number = chooseRandomAvailable(effectiveRange.rangeStart, effectiveRange.rangeEnd, reserved);
      } else {
        number = chooseSequentialAvailable(
          effectiveRange.nextSequence,
          effectiveRange.rangeStart,
          effectiveRange.rangeEnd,
          reserved,
        );
      }

      assertWithinRange(number, effectiveRange);
      const pseudonymNumber = displayPseudonymNumber(number, Math.max(displayWidth, String(number).length));
      if (preview) {
        await connection.rollback();
        return { pseudonymNumber };
      }
      if (
        input.mode === "SEQUENTIAL" &&
        input.manualNumber === undefined &&
        input.expectedNumber !== undefined &&
        input.expectedNumber !== pseudonymNumber
      ) {
        throw new ConflictException("부여 예정 가번호가 변경되었습니다. 수험생을 다시 검색한 후 저장해 주세요.");
      }
      if (input.mode === "SEQUENTIAL") {
        const next = number >= effectiveRange.rangeEnd ? effectiveRange.rangeStart : number + 1;
        if (timeRangeId) await this.repository.updateTimeRangeSequence(connection, timeRangeId, next, user.id);
        else await this.repository.updateSettingSequence(connection, setting.id, next, user.id);
      }
      const assignmentId = await this.repository.insertAssignment(
        connection,
        candidate,
        candidate.admission || "",
        uniquenessScopeKey,
        pseudonymNumber,
        input.mode,
        user.id,
      );
      if (identityDecision.writeTarget) {
        await this.identityProjection.syncSettingTree(connection, setting.id, candidate.examName);
        await this.identityProjection.syncAssignmentTree(connection, assignmentId, candidate.examName);
      }
      await this.audit.record(connection, {
        eventType: "PSEUDONYM_ASSIGNED",
        actorUserId: user.id,
        details: {
          assignmentId,
          candidateRecordId: candidate.candidateRecordId,
          mode: input.mode,
        },
      });
      await connection.commit();
      return assignmentResponse(
        candidate,
        {
          id: assignmentId,
          pseudonymNumber,
          mode: input.mode,
          assignedAt: new Date().toISOString(),
        },
        false,
      );
    } catch (error) {
      await connection.rollback();
      if (isDuplicateEntryError(error))
        throw new ConflictException("이미 부여된 가번호입니다. 수험생 정보를 다시 조회해 주세요.");
      throw toPseudonymHttpError(error);
    } finally {
      connection.release();
    }
  }
}

@Injectable()
export class ChangePseudonymOperationStatusUseCase {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(PseudonymsRepository) private readonly repository: PseudonymsRepository,
    @Inject(MutationAuditRepository)
    private readonly audit: MutationAuditRepository = new MutationAuditRepository(),
    @Inject(IdentityTransitionCoordinator)
    private readonly identityTransition: IdentityTransitionCoordinator = legacyIdentityTransitionCoordinator(),
    @Inject(IdentityBackfillProjectionRepository)
    private readonly identityProjection: IdentityBackfillProjectionRepository = new IdentityBackfillProjectionRepository(),
  ) {}

  async close(input: PseudonymOperationScopeInput, user: AuthenticatedUser) {
    const admissionName = assertAdmissionAccess(user, input.admissionName, {
      forbiddenMessage: "배정되지 않은 전형의 운영 상태를 변경할 수 없습니다.",
    });
    input = { ...input, admissionName };
    const connection = await this.pool.getConnection();
    try {
      await beginScopedWrite(connection);
      const identityDecision = await this.identityTransition.decideWrite(connection);
      assertLegacyCompatibilityWrite(identityDecision.writeLegacy, "pseudonym operation");
      const pseudonymNoUniqueness = await this.repository.loadPseudonymNumberPolicyForUpdate(connection, true);
      if (pseudonymNoUniqueness === "ADMISSION")
        await this.repository.lockAdmissionNumbers(connection, input.examName, input.admissionName);
      const operation = await lockOperationForUpdate(this.repository, connection, input);
      if (operation.closed) {
        if (identityDecision.writeTarget) {
          await this.identityProjection.syncOperationTree(connection, operation.id, input.examName);
        }
        await connection.commit();
        return this.getOperationStatus(input);
      }

      const setting = await loadSettingForUpdate(
        this.repository,
        connection,
        input.examName,
        input.admissionName,
        true,
      );
      let autoAssignedAbsenteeCount = 0;
      if (setting.autoAssignAbsenteesOnClose) {
        const timeRanges = await this.repository.listTimeRangesForUpdate(connection, setting.id);
        const uniquenessScope = operationPseudonymScope(input);
        const uniquenessScopeKey = pseudonymUniquenessScopeKey(pseudonymNoUniqueness, uniquenessScope);
        const candidates = await this.repository.listUnassignedCandidatesForUpdate(
          connection,
          input,
          setting.assignmentMethod === "PREASSIGNED",
        );
        const rangesByKey = new Map(timeRanges.map((range) => [scheduleIdentity(range), range]));
        const reserved = await this.repository.loadReservedNumbers(
          connection,
          input.examName,
          input.admissionName,
          pseudonymNoUniqueness,
          uniquenessScope,
        );
        const assignments: { candidate: (typeof candidates)[number]; number: string }[] = [];
        const nextByRange = new Map<string, number>();
        for (const candidate of candidates) {
          const exactRange =
            candidate.examDate && candidate.examTime
              ? rangesByKey.get(
                  scheduleIdentity({
                    date: candidate.examDate,
                    time: candidate.examTime,
                    period: candidate.period || "",
                    admission: candidate.admission || "",
                    unit: candidate.unit || "",
                    major: candidate.major || "",
                    building: candidate.building || "",
                    room: candidate.room || "",
                  }),
                )
              : undefined;
          const effectiveRange = exactRange || setting;
          const rangeCursorKey = `${effectiveRange.rangeStart}:${effectiveRange.rangeEnd}`;
          const nextAvailable = nextByRange.get(rangeCursorKey) ?? effectiveRange.rangeStart;
          let number: number;
          let displayWidth =
            effectiveRange.displayWidth ??
            Math.max(String(effectiveRange.rangeStart).length, String(effectiveRange.rangeEnd).length);
          if (setting.assignmentMethod === "PREASSIGNED" && candidate.preassignedNumber) {
            number = parsePseudonym(candidate.preassignedNumber);
            displayWidth = candidate.preassignedNumber.length;
            assertWithinRange(number, effectiveRange);
            const owner = await this.repository.findPreassignedOwner(
              connection,
              input.examName,
              input.admissionName,
              candidate.preassignedNumber,
              pseudonymNoUniqueness,
              uniquenessScope,
            );
            if (owner !== candidate.candidateRecordId)
              number = chooseSequentialAvailable(
                nextAvailable,
                effectiveRange.rangeStart,
                effectiveRange.rangeEnd,
                reserved,
              );
          } else {
            number = chooseSequentialAvailable(
              nextAvailable,
              effectiveRange.rangeStart,
              effectiveRange.rangeEnd,
              reserved,
            );
          }
          reserved.add(number);
          nextByRange.set(rangeCursorKey, number >= effectiveRange.rangeEnd ? effectiveRange.rangeStart : number + 1);
          const pseudonymNumber = displayPseudonymNumber(number, Math.max(displayWidth, String(number).length));
          assignments.push({ candidate, number: pseudonymNumber });
        }
        const assignmentIds = await this.repository.insertAbsenteeAssignments(
          connection,
          assignments,
          input.admissionName,
          uniquenessScopeKey,
          assignmentModeForSetting(setting.assignmentMethod),
          user.id,
        );
        if (identityDecision.writeTarget) {
          for (const assignmentId of assignmentIds)
            await this.identityProjection.syncAssignmentTree(connection, assignmentId, input.examName);
        }
        autoAssignedAbsenteeCount = assignments.length;
      }

      await this.repository.closeOperation(connection, operation.id, user.id);
      if (identityDecision.writeTarget) {
        await this.identityProjection.syncOperationTree(connection, operation.id, input.examName, {
          autoAssignedAbsenteeCount,
        });
      }
      await this.audit.record(connection, {
        eventType: "PSEUDONYM_OPERATION_CLOSED",
        actorUserId: user.id,
        details: {
          operationId: operation.id,
          examDate: input.examDate,
          examTime: input.examTime,
          periodName: input.periodName,
          admissionName: input.admissionName,
          autoAssignedAbsenteeCount,
        },
      });
      await connection.commit();
      return this.getOperationStatus(input);
    } catch (error) {
      await connection.rollback();
      throw toPseudonymHttpError(error);
    } finally {
      connection.release();
    }
  }

  async reopen(input: PseudonymOperationScopeInput, user: AuthenticatedUser) {
    const admissionName = assertAdmissionAccess(user, input.admissionName, {
      forbiddenMessage: "배정되지 않은 전형의 운영 상태를 변경할 수 없습니다.",
    });
    input = { ...input, admissionName };
    const connection = await this.pool.getConnection();
    try {
      await beginScopedWrite(connection);
      const identityDecision = await this.identityTransition.decideWrite(connection);
      assertLegacyCompatibilityWrite(identityDecision.writeLegacy, "pseudonym operation");
      await this.repository.loadPseudonymNumberPolicyForUpdate(connection);
      const operation = await this.repository.findOperationForUpdate(connection, input);
      if (!operation || !operation.closed) {
        if (operation && identityDecision.writeTarget) {
          await this.identityProjection.syncOperationTree(connection, operation.id, input.examName);
        }
        await connection.commit();
        return this.getOperationStatus(input);
      }
      const setting = await loadSettingForUpdate(this.repository, connection, input.examName, input.admissionName);
      let deletedAbsenteeCount = 0;
      if (setting.deleteAbsenteeInfoOnReopen) {
        if (identityDecision.writeTarget) {
          const assignmentIds = await this.repository.listAutoAssignedAbsenteeIdsForUpdate(connection, input);
          await this.identityProjection.removeCurrentAssignments(connection, assignmentIds, user.id);
        }
        deletedAbsenteeCount = await this.repository.deleteAutoAssignedAbsentees(connection, input);
      }
      await this.repository.reopenOperation(connection, operation.id, user.id);
      if (identityDecision.writeTarget) {
        await this.identityProjection.syncOperationTree(connection, operation.id, input.examName, {
          removedCurrentAbsenteeCount: deletedAbsenteeCount,
        });
      }
      await this.audit.record(connection, {
        eventType: "PSEUDONYM_OPERATION_REOPENED",
        actorUserId: user.id,
        details: {
          operationId: operation.id,
          examDate: input.examDate,
          examTime: input.examTime,
          periodName: input.periodName,
          admissionName: input.admissionName,
          deletedAbsenteeCount,
        },
      });
      await connection.commit();
      return this.getOperationStatus(input);
    } catch (error) {
      await connection.rollback();
      throw toPseudonymHttpError(error);
    } finally {
      connection.release();
    }
  }

  private async getOperationStatus(input: PseudonymOperationScopeInput) {
    const status = await this.repository.findOperationStatus(this.pool, input);
    const autoAssignedAbsenteeCount = await this.repository.countAutoAssignedAbsentees(this.pool, input);
    return operationStatusResponse(status, autoAssignedAbsenteeCount);
  }
}

async function loadSettingForUpdate(
  repository: PseudonymsRepository,
  connection: PoolConnection,
  examName: string,
  admissionName: string,
  shared = false,
) {
  const setting = await repository.findSetting(connection, examName, admissionName, {
    forUpdate: !shared,
    ...(shared ? { shared: true } : {}),
  });
  if (!setting) throw new NotFoundException("이 전형의 가번호 운영 설정을 찾을 수 없습니다.");
  return setting;
}

export async function ensureAndLockOperation(input: PseudonymOperationScopeInput, gateway: OperationLockGateway) {
  const params = operationParams(input);
  await gateway.ensure(params);
  const operation = await gateway.lock(params);
  if (!operation) throw new NotFoundException("교시 운영 정보를 잠그지 못했습니다.");
  return operation;
}

async function lockOperationForUpdate(
  repository: PseudonymsRepository,
  connection: PoolConnection,
  input: PseudonymOperationScopeInput,
) {
  return ensureAndLockOperation(input, {
    ensure: async () => {
      await repository.ensureOperation(connection, input);
    },
    lock: async () => {
      return repository.lockOperation(connection, input);
    },
  });
}

function operationParams(input: PseudonymOperationScopeInput) {
  return [input.examName, input.examDate, input.examTime, input.periodName, input.admissionName];
}

function legacyIdentityTransitionCoordinator(): IdentityTransitionCoordinator {
  return {
    decideWrite: async () => ({
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
    }),
  } as unknown as IdentityTransitionCoordinator;
}

function assertLegacyCompatibilityWrite(writeLegacy: boolean, domain: string): void {
  if (!writeLegacy) {
    throw new Error(`${domain} canonical writes are blocked until the target HTTP contract is activated.`);
  }
}
