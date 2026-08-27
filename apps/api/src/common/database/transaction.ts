import type { Pool, PoolConnection } from "mysql2/promise";

type ConnectionPool = Pick<Pool, "getConnection">;

export async function withTransaction<T>(
  pool: ConnectionPool,
  work: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
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
