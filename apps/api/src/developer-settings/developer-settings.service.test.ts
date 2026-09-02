import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import type { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import type { IdentityReadRouteRequest, IdentityReadRouter } from "../identity-transition/identity-read-router.js";
import type { UpdateDeveloperSettingsDto } from "./developer-settings.dto.js";
import { DeveloperSettingsService } from "./developer-settings.service.js";

const developer: AuthenticatedUser = {
  id: 9,
  loginId: "dev",
  role: "DEVELOPER",
  admissionNames: [],
};
const VALID_DEVELOPER_PASSWORD_HASH = await hashPassword("1234");

const updateInput: UpdateDeveloperSettingsDto = {
  schoolName: " 한국대학교 ",
  academicYear: 2026,
  systemName: " 가번호 관리 시스템 ",
  examineeNoUniqueness: "SYSTEM",
  pseudonymNoUniqueness: "ADMISSION",
};

describe("DeveloperSettingsService mutation transactions", () => {
  it("routes an authenticated developer policy read on one transaction connection", async () => {
    const route = vi.fn(async (_connection: SqlExecutor, request: IdentityReadRouteRequest<unknown>) => {
      const legacy = await request.legacy();
      const target = await request.target();
      expect(legacy.rows).toEqual([
        {
          entityId: 1,
          projection: { academicYear: 2026, examineeScope: "SYSTEM", pseudonymScope: "ADMISSION" },
        },
      ]);
      return { value: target.value };
    });
    const fixture = createFixture({ route } as unknown as IdentityReadRouter);

    await expect(fixture.service.getForUser(developer)).resolves.toMatchObject({
      examineeNoUniqueness: "SCHEDULE",
      pseudonymNoUniqueness: "SCHEDULE",
    });

    expect(route).toHaveBeenCalledWith(
      fixture.connection,
      expect.objectContaining({ userId: developer.id, observationType: "identity-live.developer-number-policy.v1" }),
    );
    expect(fixture.connectionCommit).toHaveBeenCalledOnce();
    expect(fixture.connectionRelease).toHaveBeenCalledOnce();
  });

  it("commits a profile update and its audit on the same connection before reading the response", async () => {
    const fixture = createFixture();

    await expect(fixture.service.update(updateInput, developer)).resolves.toMatchObject({
      schoolName: "한국대학교",
      examineeNoUniqueness: "SYSTEM",
      pseudonymNoUniqueness: "ADMISSION",
    });

    const updateCall = fixture.connectionExecute.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE system_profile"),
    );
    expect(updateCall?.[1]).toEqual(["한국대학교", 2026, "가번호 관리 시스템", "SYSTEM", "ADMISSION", 9]);
    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.connection, {
      eventType: "SYSTEM_PROFILE_UPDATED",
      actorUserId: 9,
      details: {
        schoolName: "한국대학교",
        academicYear: 2026,
        systemName: "가번호 관리 시스템",
        examineeNoUniqueness: "SYSTEM",
        pseudonymNoUniqueness: "ADMISSION",
      },
    });
    expect(fixture.audit.record.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.connectionCommit.mock.invocationCallOrder[0],
    );
    expect(fixture.connectionCommit.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.poolQuery.mock.invocationCallOrder[0],
    );
    expect(fixture.connectionRollback).not.toHaveBeenCalled();
    expect(fixture.connectionRelease).toHaveBeenCalledOnce();
  });

  it("rolls back the profile update when the database update fails", async () => {
    const fixture = createFixture();
    const updateFailure = new Error("profile update failed");
    fixture.connectionExecute.mockResolvedValueOnce([fixture.profileRows, []]).mockRejectedValueOnce(updateFailure);

    await expect(fixture.service.update(updateInput, developer)).rejects.toBe(updateFailure);

    expect(fixture.connectionRollback).toHaveBeenCalledOnce();
    expect(fixture.connectionCommit).not.toHaveBeenCalled();
    expect(fixture.audit.record).not.toHaveBeenCalled();
    expect(fixture.poolQuery).not.toHaveBeenCalled();
  });

  it("rolls back the profile update when its audit record cannot be stored", async () => {
    const fixture = createFixture();
    const auditFailure = new Error("audit unavailable");
    fixture.audit.record.mockRejectedValueOnce(auditFailure);

    await expect(fixture.service.update(updateInput, developer)).rejects.toBe(auditFailure);

    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.connection, expect.any(Object));
    expect(fixture.connectionRollback).toHaveBeenCalledOnce();
    expect(fixture.connectionCommit).not.toHaveBeenCalled();
    expect(fixture.poolQuery).not.toHaveBeenCalled();
  });

  it("applies the pseudonym scope rewrite before updating and auditing the profile", async () => {
    const fixture = createFixture();

    await fixture.service.update({ ...updateInput, pseudonymNoUniqueness: "SCHEDULE" }, developer);

    const scopeRewriteIndex = fixture.connectionExecute.mock.calls.findIndex(([sql]) =>
      String(sql).includes("UPDATE pseudonym_assignment pa"),
    );
    const profileUpdateIndex = fixture.connectionExecute.mock.calls.findIndex(([sql]) =>
      String(sql).includes("UPDATE system_profile"),
    );
    expect(scopeRewriteIndex).toBeGreaterThanOrEqual(0);
    expect(profileUpdateIndex).toBeGreaterThan(scopeRewriteIndex);
    expect(fixture.connectionExecute.mock.invocationCallOrder[profileUpdateIndex]).toBeLessThan(
      fixture.audit.record.mock.invocationCallOrder[0],
    );
  });

  it("allows schedule-scoped examinee numbers only when repeated rows share one identity", async () => {
    const fixture = createFixture();

    await fixture.service.update({ ...updateInput, examineeNoUniqueness: "SCHEDULE" }, developer);

    const identityQuery = fixture.connectionQuery.mock.calls.find(([sql]) =>
      String(sql).includes("COUNT(DISTINCT CONCAT_WS"),
    );
    expect(identityQuery).toBeDefined();
  });

  it("rejects schedule-scoped examinee numbers when personal identities conflict", async () => {
    const fixture = createFixture();
    fixture.connectionQuery.mockResolvedValueOnce([[{ conflictCount: 2 }], []]);

    await expect(
      fixture.service.update({ ...updateInput, examineeNoUniqueness: "SCHEDULE" }, developer),
    ).rejects.toThrow("서로 다른 인적 정보가 2개");

    expect(fixture.connectionRollback).toHaveBeenCalledOnce();
    expect(fixture.connectionExecute.mock.calls.some(([sql]) => String(sql).includes("UPDATE system_profile"))).toBe(
      false,
    );
  });

  it("rejects system-wide examinee uniqueness before mutation without exposing conflicting identity data", async () => {
    const fixture = createFixture();
    fixture.profileRows[0]!.examineeNoUniqueness = "SCHEDULE";
    fixture.connectionQuery.mockResolvedValueOnce([
      [{ conflictCount: 3, examineeNo: "PRIVATE-EXAMINEE-NO", name: "PRIVATE-NAME" }],
      [],
    ]);

    const error = await captureRejection(
      fixture.service.update({ ...updateInput, examineeNoUniqueness: "SYSTEM" }, developer),
    );

    expect(error.message).toBe(
      "수험번호 유일 정책을 시스템 전체로 변경할 수 없습니다. 중복된 수험번호가 3개 있습니다.",
    );
    expect(error.message).not.toContain("PRIVATE-EXAMINEE-NO");
    expect(error.message).not.toContain("PRIVATE-NAME");
    expect(fixture.connectionRollback).toHaveBeenCalledOnce();
    expect(fixture.connectionExecute.mock.calls.some(([sql]) => String(sql).includes("UPDATE system_profile"))).toBe(
      false,
    );
    expect(fixture.audit.record).not.toHaveBeenCalled();
  });

  it("rejects admission-wide pseudonym uniqueness before mutation without exposing conflicting numbers", async () => {
    const fixture = createFixture();
    fixture.profileRows[0]!.pseudonymNoUniqueness = "SCHEDULE";
    fixture.connectionQuery.mockResolvedValueOnce([[{ conflictCount: 2, pseudonymNo: "PRIVATE-PSEUDONYM-NO" }], []]);

    const error = await captureRejection(
      fixture.service.update({ ...updateInput, pseudonymNoUniqueness: "ADMISSION" }, developer),
    );

    expect(error.message).toBe("가번호 유일 정책을 전형 전체로 변경할 수 없습니다. 중복된 가번호 조합이 2개 있습니다.");
    expect(error.message).not.toContain("PRIVATE-PSEUDONYM-NO");
    expect(fixture.connectionRollback).toHaveBeenCalledOnce();
    expect(
      fixture.connectionExecute.mock.calls.some(([sql]) => String(sql).includes("UPDATE pseudonym_assignment")),
    ).toBe(false);
    expect(fixture.connectionExecute.mock.calls.some(([sql]) => String(sql).includes("UPDATE system_profile"))).toBe(
      false,
    );
    expect(fixture.audit.record).not.toHaveBeenCalled();
  });

  it("keeps the committed mutation when the post-commit response read fails", async () => {
    const fixture = createFixture();
    const readFailure = new Error("response read failed");
    fixture.poolQuery.mockRejectedValueOnce(readFailure);

    await expect(fixture.service.update(updateInput, developer)).rejects.toBe(readFailure);

    expect(fixture.connectionCommit).toHaveBeenCalledOnce();
    expect(fixture.connectionRollback).not.toHaveBeenCalled();
    expect(fixture.connectionRelease).toHaveBeenCalledOnce();
  });

  it("commits a logo upload and its audit before returning the refreshed profile", async () => {
    const fixture = createFixture();
    const file = {
      buffer: pngBuffer(),
      originalname: "logo.png",
      mimetype: "image/png",
      size: pngBuffer().length,
    };

    await expect(fixture.service.uploadLogo(file, developer)).resolves.toMatchObject({
      systemName: "가번호 관리 시스템",
    });

    expect(fixture.connectionExecute.mock.calls[0]?.[0]).toContain("FOR UPDATE");
    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.connection, {
      eventType: "SYSTEM_LOGO_UPDATED",
      actorUserId: 9,
      details: { fileName: "logo.png", mimeType: "image/png" },
    });
    expect(fixture.connectionCommit.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.poolQuery.mock.invocationCallOrder[0],
    );
  });

  it("rolls back a logo update when its audit record cannot be stored", async () => {
    const fixture = createFixture();
    const auditFailure = new Error("audit unavailable");
    fixture.audit.record.mockRejectedValueOnce(auditFailure);

    await expect(
      fixture.service.uploadLogo(
        {
          buffer: pngBuffer(),
          originalname: "logo.png",
          mimetype: "image/png",
          size: pngBuffer().length,
        },
        developer,
      ),
    ).rejects.toBe(auditFailure);

    expect(fixture.connectionRollback).toHaveBeenCalledOnce();
    expect(fixture.connectionCommit).not.toHaveBeenCalled();
    expect(fixture.poolQuery).not.toHaveBeenCalled();
  });

  it("commits logo removal and its audit in one transaction", async () => {
    const fixture = createFixture();

    await expect(fixture.service.removeLogo(developer)).resolves.toMatchObject({
      systemName: "가번호 관리 시스템",
    });

    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.connection, {
      eventType: "SYSTEM_LOGO_REMOVED",
      actorUserId: 9,
      details: {},
    });
    expect(fixture.connectionCommit).toHaveBeenCalledOnce();
    expect(fixture.connectionRollback).not.toHaveBeenCalled();
  });

  it("rejects a file whose declared logo MIME type does not match its bytes", async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.uploadLogo(
        {
          buffer: Buffer.from("<svg onload=alert(1)></svg>"),
          originalname: "logo.png",
          mimetype: "image/png",
          size: 29,
        },
        developer,
      ),
    ).rejects.toThrow("실제 이미지 형식");

    expect(fixture.connectionExecute).not.toHaveBeenCalled();
    expect(fixture.audit.record).not.toHaveBeenCalled();
  });

  it("rejects a logo whose file extension does not match the validated image type", async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.uploadLogo(
        {
          buffer: pngBuffer(),
          originalname: "logo.jpg",
          mimetype: "image/png",
          size: pngBuffer().length,
        },
        developer,
      ),
    ).rejects.toThrow("확장자와 이미지 형식");

    expect(fixture.connectionExecute).not.toHaveBeenCalled();
  });
});

function pngBuffer() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
}

describe("DeveloperSettingsService.changePassword", () => {
  it("locks and changes only the authenticated developer, then commits its audit", async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.changePassword({ currentPassword: "1234", newPassword: "5678" }, developer),
    ).resolves.toEqual({ changed: true });

    expect(fixture.connectionExecute.mock.calls[0]?.[0]).toContain(
      "WHERE id = ? AND role = 'DEVELOPER' AND enabled = TRUE LIMIT 1 FOR UPDATE",
    );
    expect(fixture.connectionExecute.mock.calls[0]?.[1]).toEqual([9]);
    const passwordUpdate = fixture.connectionExecute.mock.calls[1];
    expect(String(passwordUpdate?.[0])).toMatch(/UPDATE app_user\s+SET password_hash/);
    expect(passwordUpdate?.[0]).toContain("session_version = session_version + 1");
    expect(passwordUpdate?.[1]?.[1]).toBe(9);
    await expect(verifyPassword("5678", String(passwordUpdate?.[1]?.[0]))).resolves.toBe(true);
    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.connection, {
      eventType: "DEVELOPER_PASSWORD_CHANGED",
      actorUserId: 9,
      details: { developerUserId: 9 },
    });
    expect(fixture.connectionCommit).toHaveBeenCalledOnce();
  });

  it("rolls back an incorrect current password without updating or auditing", async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.changePassword({ currentPassword: "wrong", newPassword: "5678" }, developer),
    ).rejects.toThrow("현재 비밀번호가 올바르지 않습니다");

    expect(fixture.connectionExecute).toHaveBeenCalledOnce();
    expect(fixture.audit.record).not.toHaveBeenCalled();
    expect(fixture.connectionRollback).toHaveBeenCalledOnce();
    expect(fixture.connectionCommit).not.toHaveBeenCalled();
  });

  it("rolls back the password update when its audit record fails", async () => {
    const fixture = createFixture();
    const auditFailure = new Error("audit unavailable");
    fixture.audit.record.mockRejectedValueOnce(auditFailure);

    await expect(
      fixture.service.changePassword({ currentPassword: "1234", newPassword: "5678" }, developer),
    ).rejects.toBe(auditFailure);

    expect(fixture.connectionExecute).toHaveBeenCalledTimes(2);
    expect(fixture.connectionRollback).toHaveBeenCalledOnce();
    expect(fixture.connectionCommit).not.toHaveBeenCalled();
  });

  it("rolls back without auditing when the password update fails", async () => {
    const fixture = createFixture();
    const updateFailure = new Error("password update failed");
    fixture.connectionExecute
      .mockResolvedValueOnce([[{ id: 9, passwordHash: VALID_DEVELOPER_PASSWORD_HASH }], []])
      .mockRejectedValueOnce(updateFailure);

    await expect(
      fixture.service.changePassword({ currentPassword: "1234", newPassword: "5678" }, developer),
    ).rejects.toBe(updateFailure);

    expect(fixture.audit.record).not.toHaveBeenCalled();
    expect(fixture.connectionRollback).toHaveBeenCalledOnce();
    expect(fixture.connectionCommit).not.toHaveBeenCalled();
  });
});

function createFixture(identityReadRouter?: IdentityReadRouter) {
  const profile = {
    schoolName: "한국대학교",
    academicYear: 2026,
    systemName: "가번호 관리 시스템",
    examineeNoUniqueness: "SYSTEM",
    pseudonymNoUniqueness: "ADMISSION",
    logoFileName: null,
    logoMimeType: null,
    logoData: null,
    updatedAt: new Date("2026-08-28T00:00:00.000Z"),
  };
  const profileRows = [profile];
  const connectionExecute = vi.fn(async (sql: string, _params: unknown[] = []) => {
    if (sql.includes("FROM system_profile")) return [profileRows, []];
    if (sql.includes("FROM app_user")) {
      return [[{ id: 9, passwordHash: VALID_DEVELOPER_PASSWORD_HASH }], []];
    }
    return [{ affectedRows: 1 }, []];
  });
  const connectionQuery = vi.fn(async (sql: string): Promise<[unknown[], unknown[]]> => {
    if (sql.includes("number_uniqueness_policy")) {
      return [
        [
          {
            ...profile,
            examineeNoUniqueness: "SCHEDULE",
            pseudonymNoUniqueness: "SCHEDULE",
          },
        ],
        [],
      ];
    }
    if (sql.includes("FROM system_profile")) return [profileRows, []];
    return [[{ conflictCount: 0 }], []];
  });
  const connectionBegin = vi.fn().mockResolvedValue(undefined);
  const connectionCommit = vi.fn().mockResolvedValue(undefined);
  const connectionRollback = vi.fn().mockResolvedValue(undefined);
  const connectionRelease = vi.fn();
  const connection = {
    execute: connectionExecute,
    query: connectionQuery,
    beginTransaction: connectionBegin,
    commit: connectionCommit,
    rollback: connectionRollback,
    release: connectionRelease,
  } as unknown as PoolConnection;
  const poolQuery = vi.fn().mockResolvedValue([profileRows, []]);
  const pool = {
    getConnection: vi.fn().mockResolvedValue(connection),
    query: poolQuery,
  } as unknown as Pool;
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new DeveloperSettingsService(
    pool,
    audit as unknown as MutationAuditRepository,
    undefined,
    undefined,
    undefined,
    identityReadRouter,
  );
  return {
    audit,
    connection,
    connectionBegin,
    connectionCommit,
    connectionExecute,
    connectionQuery,
    connectionRelease,
    connectionRollback,
    pool,
    poolQuery,
    profileRows,
    service,
  };
}

async function captureRejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Expected the rejected value to be an Error.", { cause: error });
  }
  throw new Error("Expected the promise to reject.");
}
