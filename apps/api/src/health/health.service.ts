import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { Pool } from "mysql2/promise";
import { DATABASE_POOL } from "../database/database.constants.js";

@Injectable()
export class HealthService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  check() {
    return this.readiness();
  }

  liveness() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }

  async readiness() {
    const startedAt = Date.now();
    try {
      await this.pool.query("SELECT 1");
      return {
        status: "ok",
        database: "connected",
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        status: "error",
        database: "disconnected",
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
