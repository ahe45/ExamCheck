import type { Pool } from "mysql2/promise";

export type SqlExecutor = Pick<Pool, "execute" | "query">;
