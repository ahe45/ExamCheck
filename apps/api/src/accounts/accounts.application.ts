import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Pool, PoolConnection } from "mysql2/promise";
import type { AuthenticatedUser, UserRole } from "../auth/auth.types.js";
import { hashPassword } from "../auth/password.js";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { withTransaction } from "../common/database/transaction.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import type { CreateAccountDto, UpdateAccountDto } from "./accounts.dto.js";
import {
  isGeneralAccountTarget,
  isSelfRoleChangeForbidden,
  normalizeLoginId,
  resolveAdmissionAssignments,
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
  ) {}

  async create(input: CreateAccountDto, actor: AuthenticatedUser): Promise<ManagedAccountView> {
    const loginId = normalizeLoginId(input.loginId);
    const passwordHash = await hashPassword(input.password);
    return withTransaction(this.pool, async (connection) => {
      if (await this.repository.findIdByLoginId(connection, loginId)) {
        throw new ConflictException("이미 사용 중인 아이디입니다.");
      }
      const userId = await this.repository.insertAccount(
        connection,
        loginId,
        toStoredAccountRole(input.role),
        passwordHash,
      );
      await this.replaceAdmissions(connection, userId, input.role, input.admissionNames);
      const account = await this.requireAccount(connection, userId);
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
      await this.replaceAdmissions(connection, id, input.role, input.admissionNames);
      const account = await this.requireAccount(connection, id);
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
      const target = await this.repository.findTargetForUpdate(connection, id);
      if (!target) throw new NotFoundException("계정을 찾을 수 없습니다.");
      assertGeneralAccountTarget(target);
      if (!(await this.repository.disableAccount(connection, id))) {
        throw new NotFoundException("계정을 찾을 수 없습니다.");
      }
      await this.repository.deleteAdmissionAssignments(connection, id);
      await this.audit.record(connection, {
        eventType: "ACCOUNT_DELETED",
        actorUserId: actor.id,
        details: { userId: id },
      });
      return { id, deleted: true };
    });
  }

  private async replaceAdmissions(
    connection: PoolConnection,
    userId: number,
    role: ManagedAccountRole,
    requestedAdmissionNames: readonly string[],
  ): Promise<void> {
    await this.repository.deleteAdmissionAssignments(connection, userId);
    const availableAdmissionNames = role === "ADMIN" ? [] : await this.repository.listAdmissionNames(connection);
    const resolution = resolveAdmissionAssignments(role, requestedAdmissionNames, availableAdmissionNames);
    if (resolution.invalidAdmissionName) {
      throw new NotFoundException(`등록되지 않은 전형입니다: ${resolution.invalidAdmissionName}`);
    }
    for (const admissionName of resolution.admissionNames) {
      await this.repository.insertAdmissionAssignment(connection, userId, admissionName);
    }
  }

  private async requireAccount(connection: PoolConnection, id: number): Promise<ManagedAccountView> {
    const account = await this.repository.findOne(connection, id);
    if (!account) throw new NotFoundException("계정을 찾을 수 없습니다.");
    return account;
  }
}

export function assertGeneralAccountTarget(target: { role: UserRole }): void {
  if (!isGeneralAccountTarget(target.role)) {
    throw new ForbiddenException("개발자 계정은 일반 계정 관리에서 변경하거나 삭제할 수 없습니다.");
  }
}
