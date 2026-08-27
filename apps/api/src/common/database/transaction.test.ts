import type { Pool, PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { withTransaction } from "./transaction.js";

describe("withTransaction", () => {
  it("commits successful work and always releases the connection", async () => {
    const connection = createConnection();
    const work = vi.fn().mockResolvedValue("done");

    await expect(withTransaction(createPool(connection), work)).resolves.toBe("done");

    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(work).toHaveBeenCalledWith(connection);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it("rolls back failed work, releases the connection, and rethrows the same error", async () => {
    const connection = createConnection();
    const failure = new Error("work failed");

    await expect(
      withTransaction(createPool(connection), async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it("rolls back a commit failure and rethrows the commit error", async () => {
    const connection = createConnection();
    const failure = new Error("commit failed");
    vi.mocked(connection.commit).mockRejectedValue(failure);

    await expect(withTransaction(createPool(connection), async () => 1)).rejects.toBe(failure);

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it("does not roll back when begin fails but still releases and rethrows", async () => {
    const connection = createConnection();
    const failure = new Error("begin failed");
    vi.mocked(connection.beginTransaction).mockRejectedValue(failure);

    await expect(withTransaction(createPool(connection), async () => 1)).rejects.toBe(failure);

    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it("keeps the original work error when rollback also fails", async () => {
    const connection = createConnection();
    const failure = new Error("work failed");
    vi.mocked(connection.rollback).mockRejectedValue(new Error("rollback failed"));

    await expect(
      withTransaction(createPool(connection), async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(connection.release).toHaveBeenCalledOnce();
  });
});

function createPool(connection: PoolConnection): Pick<Pool, "getConnection"> {
  return { getConnection: vi.fn().mockResolvedValue(connection) };
}

function createConnection(): PoolConnection {
  return {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  } as unknown as PoolConnection;
}
