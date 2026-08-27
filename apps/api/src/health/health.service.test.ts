import { ServiceUnavailableException } from "@nestjs/common";
import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { HealthService } from "./health.service.js";

describe("HealthService", () => {
  it("reports liveness without querying the database", () => {
    const query = vi.fn();
    const service = new HealthService({ query } as unknown as Pool);

    const result = service.liveness();

    expect(result.status).toBe("ok");
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(query).not.toHaveBeenCalled();
  });

  it("keeps the existing health response while reporting database readiness", async () => {
    const query = vi.fn(async () => [[]]);
    const service = new HealthService({ query } as unknown as Pool);

    const result = await service.check();

    expect(query).toHaveBeenCalledWith("SELECT 1");
    expect(result).toMatchObject({ status: "ok", database: "connected" });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns a sanitized 503 readiness response when the database is unavailable", async () => {
    const query = vi.fn(async () => {
      throw new Error("password leaked from driver");
    });
    const service = new HealthService({ query } as unknown as Pool);

    const error = await service.readiness().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
      status: "error",
      database: "disconnected",
    });
    expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).not.toContain("password leaked");
  });
});
