import "reflect-metadata";
import { Module } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Pool } from "mysql2/promise";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { API_GLOBAL_PREFIX, configureApplication } from "../application-config.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import { HealthController } from "../health/health.controller.js";
import { HealthService } from "../health/health.service.js";

let databaseAvailable = true;
const query = vi.fn(async () => {
  if (!databaseAvailable) throw new Error("driver details are private");
  return [[]];
});

@Module({
  controllers: [HealthController],
  providers: [HealthService, { provide: DATABASE_POOL, useValue: { query } as unknown as Pool }],
})
class HealthHttpE2eModule {}

describe("health HTTP boundaries", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(HealthHttpE2eModule, { logger: false });
    configureApplication(app, {
      frontendOrigin: "http://localhost:5173",
      requestLogWriter: () => undefined,
    });
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as AddressInfo | string | null;
    if (!address || typeof address === "string") throw new Error("Health HTTP server did not bind to a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}/${API_GLOBAL_PREFIX}/health`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("serves liveness without touching the database", async () => {
    query.mockClear();
    const response = await fetch(`${baseUrl}/live`);
    const body = (await response.json()) as { status: string; timestamp: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeTruthy();
    expect(query).not.toHaveBeenCalled();
  });

  it("keeps /health compatible and exposes the explicit readiness route", async () => {
    databaseAvailable = true;
    const legacy = await fetch(baseUrl);
    const ready = await fetch(`${baseUrl}/ready`);

    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toMatchObject({ status: "ok", database: "connected" });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ status: "ok", database: "connected" });
  });

  it("returns sanitized readiness details with HTTP 503 when the database is down", async () => {
    databaseAvailable = false;
    const response = await fetch(`${baseUrl}/ready`);
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toMatchObject({ status: "error", database: "disconnected" });
    expect(text).not.toContain("driver details");
    databaseAvailable = true;
  });
});
