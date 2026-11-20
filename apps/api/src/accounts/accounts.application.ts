import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Pool, PoolConnection } from "mysql2/promise";
import type { AuthenticatedUser, UserRole } from "../auth/auth.types.js";
import type { ClassificationMethod } from "../authorization/classification.js";
import { hashPassword } from "../auth/password.js";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { withTransaction } from "../common/database/transaction.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import { IdentityBackfillProjectionRepository } from "../database/identity-backfill-projection.repository.js";
import { IdentityTransitionCoordinator } from "../identity-transition/identity-transition-coordinator.js";
import type { CreateAccountDto, UpdateAccountDto } from "./accounts.dto.js";
import {
  isGeneralAccountTarget,
  isSelfRoleChangeForbidden,
  normalizeLoginId,
  resolveAdmissionAssignments,
  toManagedAccountRole,
  toStoredAccountRole,
  type ManagedAccountRole,
} from "./accounts.domain.js";
import { AccountsRepository, type ManagedAccountView } from "./accounts.repository.js";

@Injectable()
export class AccountsApplicationService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(AccountsRepository) private readonly repository: AccountsRepository,
    @Inject(MutationAuditRepository) private readonly audit: MutationAuditRepository,
    @Inject(IdentityTransitionCoordinator)
    private readonly identityTransition: IdentityTransitionCoordinator = legacyIdentityTransitionCoordinator(),
    @Inject(IdentityBackfillProjectionRepository)
    private readonly identityProjection: IdentityBackfillProjectionRepository = new IdentityBackfillProjectionRepository(),
  ) {}

  async create(input: CreateAccountDto, actor: AuthenticatedUser): Promise<ManagedAccountView> {
    const loginId = normalizeLoginId(input.loginId);
    const passwordHash = await hashPassword(input.password);
    return withTransaction(this.pool, async (connection) => {
      const identityDecision = await this.identityTransition.decideWrite(connection);
      assertLegacyCompatibilityWrite(identityDecision.writeLegacy);
      const method = await this.classificationForWrite(connection, input.classificationMethod, actor);
      if (await this.repository.findIdByLoginId(connection, loginId)) {
        throw new ConflictException("이미 사용 중인 아이디입니다.");
      }
      const userId = await this.repository.insertAccount(
        connection,
        loginId,
        toStoredAccountRole(input.role),
        passwordHash,
      );
      await this.replaceAccess(connection, userId, input.role, input.admissionNames, method);
      if (identityDecision.writeTarget) {
        await this.identityProjection.syncAccountForCurrentCycle(connection, userId);
      }
      const account = await this.requireAccount(connection, userId, method);
      await this.audit.record(connection, {
        eventType: "ACCOUNT_CREATED",
        actorUserId: actor.id,
        details: { userId, loginId, role: input.role },
      });
      return account;
    });
  }

  async update(id: number, input: UpdateAccountDto, actor: AuthenticatedUser): Promise<ManagedAccountView> {
    if (isSelfRoleChangeForbidden(actor.id, id, input.role)) {
      throw new ForbiddenException("현재 로그인한 관리자 계정의 권한은 변경할 수 없습니다.");
    }
    const loginId = normalizeLoginId(input.loginId);
    const passwordHash = input.password ? await hashPassword(input.password) : undefined;
    return withTransaction(this.pool, async (connection) => {
      const identityDecision = await this.identityTransition.decideWrite(connection);
      assertLegacyCompatibilityWrite(identityDecision.writeLegacy);
      const method = await this.classificationForWrite(connection, input.classificationMethod, actor);
      const target = await this.repository.findTargetForUpdate(connection, id);
      if (!target) throw new NotFoundException("계정을 찾을 수 없습니다.");
      assertGeneralAccountTarget(target);
      if (await this.repository.findIdByLoginId(connection, loginId, id)) {
        throw new ConflictException("이미 사용 중인 아이디입니다.");
      }
      const storedRole = toStoredAccountRole(input.role);
      await this.repository.updateAccount(connection, id, {
        loginId,
        role: storedRole,
        ...(passwordHash ? { passwordHash } : {}),
        invalidateSessions: Boolean(input.password) || target.role !== storedRole,
      });
      if (!input.preserveClassificationAccess || toManagedAccountRole(target.role) !== input.role) {
        await this.replaceAccess(connection, id, input.role, input.admissionNames, method);
      }
      if (identityDecision.writeTarget) {
        await this.identityProjection.syncAccountForCurrentCycle(connection, id);
      }
      const account = await this.requireAccount(connection, id, method);
      await this.audit.record(connection, {
        eventType: "ACCOUNT_UPDATED",
        actorUserId: actor.id,
        details: { userId: id, loginId, role: input.role, passwordChanged: Boolean(input.password) },
      });
      return account;
    });
  }

  async remove(id: number, actor: AuthenticatedUser): Promise<{ id: number; deleted: true }> {
    if (id === actor.id) throw new ForbiddenException("현재 로그인한 계정은 삭제할 수 없습니다.");
    return withTransaction(this.pool, async (connection) => {
      const identityDecision = await this.identityTransition.decideWrite(connection);
      assertLegacyCompatibilityWrite(identityDecision.writeLegacy);
      const target = await this.repository.findTargetForUpdate(connection, id);
      if (!target) throw new NotFoundException("계정을 찾을 수 없습니다.");
      assertGeneralAccountTarget(target);
      if (!(await this.repository.disableAccount(connection, id))) {
        throw new NotFoundException("계정을 찾을 수 없습니다.");
      }
      await this.repository.deleteAdmissionAssignments(connection, id);
      await this.repository.deleteClassificationAssignments(connection, id);
      if (identityDecision.writeTarget) await this.identityProjection.clearAccountScope(connection, id);
      await this.audit.record(connection, {
        eventType: "ACCOUNT_DELETED",
        actorUserId: actor.id,
        details: { userId: id },
      });
      return { id, deleted: true };
    });
  }

  private async classificationForWrite(
    connection: PoolConnection,
    requested: ClassificationMethod | undefined,
    actor: AuthenticatedUser,
  ) {
    const observed = actor.classificationMethod ?? "ADMISSION";
    if (requested === undefined && observed === "ADMISSION") return observed;
    const current = await this.repository.lockClassificationMethod(connection);
    if ((requested ?? "ADMISSION") !== current)
      throw new ConflictException("분류 방법이 변경되었습니다. 계정 관리 화면을 새로고침해 주세요.");
    return current;
  }

  private async replaceAccess(
    connection: PoolConnection,
    userId: number,
    role: ManagedAccountRole,
    requestedAdmissionNames: readonly string[],
    method: ClassificationMethod,
  ): Promise<void> {
    if (method !== "ADMISSION") {
      const available =
        role === "ADMIN" || method === "NONE"
          ? []
          : (await this.repository.listClassificationScopes(connection, method)).map((scope) => scope.key);
      const resolution = resolveAdmissionAssignments(role, requestedAdmissionNames, available);
      if (resolution.invalidAdmissionName) throw new NotFoundException("현재 분류 방법에 등록되지 않은 항목입니다.");
      await this.repository.replaceClassificationAssignments(connection, userId, method, resolution.admissionNames);
      return;
    }
    await this.repository.deleteAdmissionAssignments(connection, userId);
    const availableAdmissionNames = role === "ADMIN" ? [] : await this.repository.listAdmissionNames(connection);
    const resolution = resolveAdmissionAssignments(role, requestedAdmissionNames, availableAdmissionNames);
    if (resolution.invalidAdmissionName) {
      throw new NotFoundException(`등록되지 않은 전형입니다: ${resolution.invalidAdmissionName}`);
    }
    for (const admissionName of resolution.admissionNames) {
      await this.repository.insertAdmissionAssignment(connection, userId, admissionName);
    }
    await this.repository.setUnrestrictedAdmissionAccess(
      connection,
      userId,
      role === "USER" && resolution.admissionNames.length === 0,
    );
  }

  private async requireAccount(
    connection: PoolConnection,
    id: number,
    method: ClassificationMethod,
  ): Promise<ManagedAccountView> {
    const account =
      method === "ADMISSION"
        ? await this.repository.findOne(connection, id)
        : await this.repository.findOne(connection, id, method);
    if (!account) throw new NotFoundException("계정을 찾을 수 없습니다.");
    return account;
  }
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

function assertLegacyCompatibilityWrite(writeLegacy: boolean): void {
  if (!writeLegacy) {
    throw new Error("Account canonical writes are blocked until the target account contract is activated.");
  }
}

export function assertGeneralAccountTarget(target: { role: UserRole }): void {
  if (!isGeneralAccountTarget(target.role)) {
    throw new ForbiddenException("개발자 계정은 일반 계정 관리에서 변경하거나 삭제할 수 없습니다.");
  }
}
