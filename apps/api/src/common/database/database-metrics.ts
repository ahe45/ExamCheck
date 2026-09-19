import type { Pool } from "mysql2/promise";
import { getCurrentDatabaseMetrics } from "../http/request-context.js";
export function instrumentDatabasePool(pool: Pool): Pool {
  if (process.env.EXAMCHECK_PERFORMANCE_METRICS !== "1") return pool;
  const wrap = <T extends object>(target: T): T => {
    let transactionStart: number | null = null;
    return new Proxy(target, {
      get(object, key) {
        const method = Reflect.get(object, key);
        if (typeof method !== "function") return method;
        if (!["execute", "query", "getConnection", "beginTransaction", "commit", "rollback"].includes(String(key)))
          return method.bind(object);
        return async (...args: unknown[]) => {
          const stats = getCurrentDatabaseMetrics();
          const started = performance.now();
          try {
            const result = await Reflect.apply(method, object, args);
            if (key === "getConnection") return wrap(result);
            if (
              key === "beginTransaction" ||
              ((key === "query" || key === "execute") &&
                typeof args[0] === "string" &&
                /^\s*(?:START TRANSACTION|BEGIN)\b/i.test(args[0]))
            )
              transactionStart = performance.now();
            if (stats && (key === "execute" || key === "query") && Array.isArray(result?.[0]))
              stats.rows += result[0].length;
            return result;
          } finally {
            const elapsed = performance.now() - started;
            if (stats && key === "getConnection") stats.acquireMs += elapsed;
            if (stats && (key === "execute" || key === "query")) {
              stats.queries++;
              stats.queryMs += elapsed;
            }
            if ((key === "commit" || key === "rollback") && transactionStart !== null) {
              if (stats) stats.transactionMs += performance.now() - transactionStart;
              transactionStart = null;
            }
          }
        };
      },
    });
  };
  return wrap(pool);
}
