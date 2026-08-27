import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { AccountsApplicationService } from "./accounts.application.js";
import { AccountsRepository, type ManagedAccountView } from "./accounts.repository.js";
import { AccountsService, assertGeneralAccountTarget } from "./accounts.service.js";

const administrator: AuthenticatedUser = {
  id: 1,
  loginId: "admin",
  role: "ADMIN",
  admissionNames: [],
};

describe("general account target policy", () => {
  it("blocks developer accounts from general account management", () => {
    expect(() => assertGeneralAccountTarget({ role: "DEVELOPER" })).toThrow(ForbiddenException);
    expect(() => assertGeneralAccountTarget({ role: "DEVELOPER" })).toThrow(
      "개발자 계정은 일반 계정 관리에서 변경하거나 삭제할 수 없습니다.",
    );
  });

  it("keeps administrator and operator accounts manageable", () => {
    expect(() => assertGeneralAccountTarget({ role: "ADMIN" })).not.toThrow();
    expect(() => assertGeneralAccountTarget({ role: "OPERATOR" })).not.toThrow();
    expect(() => assertGeneralAccountTarget({ role: "VIEWER" })).not.toThrow();
  });

  it("rolls back before updating a developer account", async () => {
    const fixture = createFixture();
    fixture.repository.findTargetForUpdate.mockResolvedValue({ id: 3, role: "DEVELOPER" });

    await expect(
      fixture.service.update(
        3,
        {
          loginId: "dev",
          role: "ADMIN",
          admissionNames: [],
        },
        administrator,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(fixture.connection.rollback).toHaveBeenCalledOnce();
    expect(fixture.connection.commit).not.toHaveBeenCalled();
    expect(fixture.audit.record).not.toHaveBeenCalled();
  });

  it("rolls back before deleting a developer account", async () => {
    const fixture = createFixture();
    fixture.repository.findTargetForUpdate.mockResolvedValue({ id: 3, role: "DEVELOPER" });

    await expect(fixture.service.remove(3, administrator)).rejects.toThrow(ForbiddenException);

    expect(fixture.connection.rollback).toHaveBeenCalledOnce();
    expect(fixture.connection.commit).not.toHaveBeenCalled();
    expect(fixture.audit.record).not.toHaveBeenCalled();
  });

  it("validates admission assignments through the active transaction connection", async () => {
    const fixture = createFixture();
    fixture.repository.findIdByLoginId.mockResolvedValue(null);
    fixture.repository.insertAccount.mockResolvedValue(4);
    fixture.repository.listAdmissionNames.mockResolvedValue(["등록 전형"]);

    await expect(
      fixture.service.create(
        {
          loginId: "operator-2",
          role: "USER",
          password: "password",
          admissionNames: ["없는 전형"],
        },
        administrator,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(fixture.repository.listAdmissionNames).toHaveBeenCalledWith(fixture.connection);
    expect(fixture.connection.rollback).toHaveBeenCalledOnce();
    expect(fixture.connection.commit).not.toHaveBeenCalled();
    expect(fixture.audit.record).not.toHaveBeenCalled();
  });

  it("records a successful mutation through the same connection before committing", async () => {
    const fixture = createFixture();
    const account = accountView(4);
    fixture.repository.findIdByLoginId.mockResolvedValue(null);
    fixture.repository.insertAccount.mockResolvedValue(4);
    fixture.repository.listAdmissionNames.mockResolvedValue(["등록 전형"]);
    fixture.repository.findOne.mockResolvedValue(account);

    await expect(
      fixture.service.create(
        {
          loginId: " operator-2 ",
          role: "USER",
          password: "password",
          admissionNames: ["등록 전형"],
        },
        administrator,
      ),
    ).resolves.toEqual(account);

    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.connection, {
      eventType: "ACCOUNT_CREATED",
      actorUserId: 1,
      details: { userId: 4, loginId: "operator-2", role: "USER" },
    });
    expect(fixture.audit.record.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fixture.connection.commit).mock.invocationCallOrder[0],
    );
    expect(fixture.connection.commit).toHaveBeenCalledOnce();
  });

  it("rolls back the account mutation when its audit record cannot be stored", async () => {
    const fixture = createFixture();
    const auditFailure = new Error("audit unavailable");
    fixture.repository.findIdByLoginId.mockResolvedValue(null);
    fixture.repository.insertAccount.mockResolvedValue(4);
    fixture.repository.findOne.mockResolvedValue(accountView(4));
    fixture.audit.record.mockRejectedValue(auditFailure);

    await expect(
      fixture.service.create(
        {
          loginId: "admin-2",
          role: "ADMIN",
          password: "password",
          admissionNames: [],
        },
        administrator,
      ),
    ).rejects.toBe(auditFailure);

    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.connection, expect.any(Object));
    expect(fixture.connection.rollback).toHaveBeenCalledOnce();
    expect(fixture.connection.commit).not.toHaveBeenCalled();
  });

  it("invalidates sessions for password or role changes but not for a login ID-only edit", async () => {
    const loginOnly = createFixture();
    loginOnly.repository.findTargetForUpdate.mockResolvedValue({ id: 4, role: "OPERATOR" });
    loginOnly.repository.findIdByLoginId.mockResolvedValue(null);
    loginOnly.repository.findOne.mockResolvedValue(accountView(4));

    await loginOnly.service.update(4, { loginId: "renamed", role: "USER", admissionNames: [] }, administrator);
    expect(loginOnly.repository.updateAccount).toHaveBeenCalledWith(loginOnly.connection, 4, {
      loginId: "renamed",
      role: "OPERATOR",
      invalidateSessions: false,
    });
    expect(loginOnly.audit.record).toHaveBeenCalledWith(loginOnly.connection, {
      eventType: "ACCOUNT_UPDATED",
      actorUserId: administrator.id,
      details: { userId: 4, loginId: "renamed", role: "USER", passwordChanged: false },
    });

    const roleChange = createFixture();
    roleChange.repository.findTargetForUpdate.mockResolvedValue({ id: 5, role: "OPERATOR" });
    roleChange.repository.findIdByLoginId.mockResolvedValue(null);
    roleChange.repository.findOne.mockResolvedValue(accountView(5));
    await roleChange.service.update(5, { loginId: "promoted", role: "ADMIN", admissionNames: [] }, administrator);
    expect(roleChange.repository.updateAccount).toHaveBeenCalledWith(
      roleChange.connection,
      5,
      expect.objectContaining({ role: "ADMIN", invalidateSessions: true }),
    );

    const passwordChange = createFixture();
    passwordChange.repository.findTargetForUpdate.mockResolvedValue({ id: 6, role: "OPERATOR" });
    passwordChange.repository.findIdByLoginId.mockResolvedValue(null);
    passwordChange.repository.findOne.mockResolvedValue(accountView(6));
    await passwordChange.service.update(
      6,
      { loginId: "operator-6", role: "USER", password: "new-password", admissionNames: [] },
      administrator,
    );
    expect(passwordChange.repository.updateAccount).toHaveBeenCalledWith(
      passwordChange.connection,
      6,
      expect.objectContaining({ passwordHash: expect.any(String), invalidateSessions: true }),
    );
    expect(passwordChange.audit.record).toHaveBeenCalledWith(passwordChange.connection, {
      eventType: "ACCOUNT_UPDATED",
      actorUserId: administrator.id,
      details: { userId: 6, loginId: "operator-6", role: "USER", passwordChanged: true },
    });
  });

  it("rolls back session invalidation together with an account update when auditing fails", async () => {
    const fixture = createFixture();
    fixture.repository.findTargetForUpdate.mockResolvedValue({ id: 4, role: "OPERATOR" });
    fixture.repository.findIdByLoginId.mockResolvedValue(null);
    fixture.repository.findOne.mockResolvedValue(accountView(4));
    fixture.audit.record.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      fixture.service.update(
        4,
        { loginId: "operator-4", role: "USER", password: "new-password", admissionNames: [] },
        administrator,
      ),
    ).rejects.toThrow("audit unavailable");

    expect(fixture.repository.updateAccount).toHaveBeenCalledWith(
      fixture.connection,
      4,
      expect.objectContaining({ invalidateSessions: true }),
    );
    expect(fixture.connection.rollback).toHaveBeenCalledOnce();
    expect(fixture.connection.commit).not.toHaveBeenCalled();
  });
});

describe("AccountsRepository session invalidation SQL", () => {
  it("increments the version in the same password/role update statement", async () => {
    const executor = { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]) };
    const repository = new AccountsRepository();

    await repository.updateAccount(executor as unknown as SqlExecutor, 4, {
      loginId: "operator-4",
      role: "ADMIN",
      passwordHash: "hashed-password",
      invalidateSessions: true,
    });

    expect(executor.execute.mock.calls[0]?.[0]).toContain("session_version = session_version + 1");
  });

  it("increments the version atomically when disabling an account", async () => {
    const executor = { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]) };
    const repository = new AccountsRepository();

    await expect(repository.disableAccount(executor as unknown as SqlExecutor, 4)).resolves.toBe(true);
    expect(executor.execute.mock.calls[0]?.[0]).toContain("session_version = session_version + 1");
  });
});

describe("AccountsService delegation", () => {
  it("uses the repository for reads and the application layer for mutations", async () => {
    const fixture = createFixture();
    fixture.repository.list.mockResolvedValue([accountView(2)]);
    fixture.repository.listAdmissionNames.mockResolvedValue(["전형 A"]);

    await expect(fixture.service.list()).resolves.toHaveLength(1);
    await expect(fixture.service.admissions()).resolves.toEqual(["전형 A"]);

    expect(fixture.repository.list).toHaveBeenCalledWith(fixture.pool);
    expect(fixture.repository.listAdmissionNames).toHaveBeenCalledWith(fixture.pool);
  });
});

function createFixture() {
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  } as unknown as PoolConnection;
  const pool = {
    getConnection: vi.fn().mockResolvedValue(connection),
  } as unknown as Pool;
  const repository = {
    list: vi.fn(),
    findOne: vi.fn(),
    listAdmissionNames: vi.fn(),
    findIdByLoginId: vi.fn(),
    insertAccount: vi.fn(),
    findTargetForUpdate: vi.fn(),
    updateAccount: vi.fn(),
    disableAccount: vi.fn(),
    deleteAdmissionAssignments: vi.fn(),
    insertAdmissionAssignment: vi.fn(),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const application = new AccountsApplicationService(
    pool,
    repository as unknown as AccountsRepository,
    audit as unknown as MutationAuditRepository,
  );
  const service = new AccountsService(pool, repository as unknown as AccountsRepository, application);
  return { audit, connection, pool, repository, service };
}

function accountView(id: number): ManagedAccountView {
  return {
    id,
    loginId: `operator-${id}`,
    role: "USER",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    admissionNames: ["등록 전형"],
  };
}
