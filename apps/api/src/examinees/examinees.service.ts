import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { Pool } from "mysql2/promise";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import {
  ADMISSION_SQL_COLUMNS,
  assertAdmissionAccess,
  buildAdmissionAccessPredicate,
} from "../authorization/admission-policy.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import { ExamineesRepository } from "./examinees.repository.js";
import type { ExamineeLookupResult, ExamineeRow, OperationScheduleScope } from "./examinees.types.js";

export type { ExamineeLookupResult, ExamineeRow, OperationScheduleScope } from "./examinees.types.js";

@Injectable()
export class ExamineesService {
  private readonly examName: string;
  private readonly repository: ExamineesRepository;

  constructor(
    @Inject(DATABASE_POOL) pool: Pool,
    @Inject(APP_CONFIG) config: Readonly<AppConfig>,
    @Optional() repository?: ExamineesRepository,
  ) {
    this.examName = config.candidates.defaultExamName;
    this.repository = repository ?? new ExamineesRepository(pool);
  }

  async listSchedules(user: AuthenticatedUser) {
    const access = buildAdmissionAccessPredicate(user, ADMISSION_SQL_COLUMNS.candidateRecord);
    return this.repository.listSchedules(access);
  }

  async listRoster(scope: OperationScheduleScope, user: AuthenticatedUser): Promise<ExamineeRow[]> {
    assertScheduleScope(scope);
    const admissionName = assertAdmissionAccess(user, scope.admissionName);
    const rows = await this.repository.listRoster(scope, admissionName);
    return rows.map((row) => normalizeExaminee(row, this.examName));
  }

  async findActiveByNumber(
    examineeNo: string,
    scope: OperationScheduleScope,
    user: AuthenticatedUser,
  ): Promise<ExamineeRow> {
    assertScheduleScope(scope);
    const admissionName = assertAdmissionAccess(user, scope.admissionName);
    const row = await this.repository.findCurrent(examineeNo.trim(), scope, admissionName);
    if (!row) throw new NotFoundException("선택한 전형·교시에 해당하는 수험생을 찾을 수 없습니다.");
    return normalizeExaminee(row, this.examName);
  }

  async lookupByNumber(
    examineeNo: string,
    scope: OperationScheduleScope,
    user: AuthenticatedUser,
  ): Promise<ExamineeLookupResult> {
    assertScheduleScope(scope);
    const admissionName = assertAdmissionAccess(user, scope.admissionName);
    const normalizedNumber = examineeNo.trim();
    const current = await this.repository.findCurrent(normalizedNumber, scope, admissionName);
    if (current) {
      return { status: "CURRENT", examinee: normalizeExaminee(current, this.examName) };
    }

    const access = buildAdmissionAccessPredicate(user, ADMISSION_SQL_COLUMNS.candidateRecord);
    const schedules = await this.repository.listOtherSchedules(normalizedNumber, access);
    if (!schedules.length) return { status: "NOT_FOUND", examineeNo: normalizedNumber };
    return {
      status: "OTHER_SCHEDULE",
      examineeNo: normalizedNumber,
      name: schedules[0].name,
      schedules,
    };
  }

  async findPhotoByNumber(examineeNo: string, scope: OperationScheduleScope, user: AuthenticatedUser) {
    assertScheduleScope(scope);
    const admissionName = assertAdmissionAccess(user, scope.admissionName);
    const photo = await this.repository.findPhoto(examineeNo.trim(), scope, admissionName);
    if (!photo) throw new NotFoundException("등록된 수험생 사진이 없습니다.");
    return photo;
  }
}

function normalizeExaminee(row: ExamineeRow, examName: string): ExamineeRow {
  return {
    ...row,
    examName,
    preassignedAvailable: Boolean(row.preassignedAvailable),
    absent: Boolean(row.absent),
  };
}

function assertScheduleScope(scope: OperationScheduleScope) {
  if (!scope.date || !scope.time || !scope.periodName || !scope.admissionName) {
    throw new BadRequestException("전형과 교시를 먼저 선택해 주세요.");
  }
}
