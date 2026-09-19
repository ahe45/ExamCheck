import type { Pool, PoolConnection } from "mysql2/promise";

type ConnectionPool = Pick<Pool, "getConnection">;

export async function withTransaction<T>(
  pool: ConnectionPool,
  work: (connection: PoolConnection) => Promise<T>,
  scoped = false,
): Promise<T> {
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    if (scoped) await beginScopedWrite(connection);
    else await connection.beginTransaction();
    transactionStarted = true;
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original work/commit error. The caller needs the real cause.
      }
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function beginReadSnapshot(connection: PoolConnection) {
  await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
}

// Scope mutexes protect the number policy and range. READ COMMITTED prevents
// unrelated, empty ranges from sharing InnoDB next-key gap locks.
export async function beginScopedWrite(connection: PoolConnection) {
  await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
  await connection.beginTransaction();
}

export function withScopedTransaction<T>(
  pool: ConnectionPool,
  work: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  return withTransaction(pool, work, true);
}
