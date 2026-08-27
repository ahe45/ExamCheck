import type { ResultSetHeader } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { bootstrapInitialAccounts, type InitialAccountBootstrapConnection } from "./initial-account-bootstrap.js";

describe("initial account bootstrap", () => {
  it("does not require production bootstrap passwords when every account exists", async () => {
    const connection = bootstrapConnection([{ loginId: "admin" }, { loginId: "가번호" }, { loginId: "dev" }]);
    const hasher = vi.fn((password: string) => `hashed:${password}`);

    const result = await bootstrapInitialAccounts(connection, { NODE_ENV: "production" }, hasher);

    expect(result).toEqual({
      existingLoginIds: ["admin", "가번호", "dev"],
      createdLoginIds: [],
    });
    expect(hasher).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it("hashes and inserts only missing accounts", async () => {
    const connection = bootstrapConnection([{ loginId: "admin" }, { loginId: "dev" }]);
    const hasher = vi.fn((password: string) => `hashed:${password}`);

    const result = await bootstrapInitialAccounts(
      connection,
      { NODE_ENV: "production", USER_INITIAL_PASSWORD: "operator-secret" },
      hasher,
    );

    expect(result.createdLoginIds).toEqual(["가번호"]);
    expect(hasher).toHaveBeenCalledExactlyOnceWith("operator-secret");
    expect(connection.execute).toHaveBeenLastCalledWith(expect.stringContaining("INSERT IGNORE INTO app_user"), [
      "가번호",
      "OPERATOR",
      "hashed:operator-secret",
    ]);
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it("rolls back before inserting when a missing production account has an unsafe password", async () => {
    const connection = bootstrapConnection([{ loginId: "가번호" }, { loginId: "dev" }]);

    await expect(
      bootstrapInitialAccounts(
        connection,
        { NODE_ENV: "production", ADMIN_INITIAL_PASSWORD: "1234" },
        vi.fn((password: string) => `hashed:${password}`),
      ),
    ).rejects.toThrow("ADMIN_INITIAL_PASSWORD");

    expect(connection.execute).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});

function bootstrapConnection(existingRows: Array<{ loginId: string }>) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce([existingRows, []])
    .mockResolvedValue([{ affectedRows: 1 } as ResultSetHeader, []]);
  return {
    execute,
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  } as unknown as InitialAccountBootstrapConnection;
}
