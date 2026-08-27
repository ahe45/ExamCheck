import "reflect-metadata";
import { BadRequestException, ConflictException, Controller, Get, Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API_GLOBAL_PREFIX, configureApplication } from "../../application-config.js";
import { REQUEST_ID_HEADER } from "./http-boundary.js";

@Controller("http-boundary")
class HttpBoundaryTestController {
  @Get("ok")
  ok() {
    return { ok: true };
  }

  @Get("candidate/:studentNo")
  candidate() {
    return { ok: true };
  }

  @Get("validation")
  validation() {
    throw new BadRequestException({
      statusCode: 400,
      message: ["loginId must not be empty", "password must be longer than or equal to 4 characters"],
      error: "Bad Request",
    });
  }

  @Get("conflict")
  conflict() {
    throw new ConflictException("이미 등록된 값입니다.");
  }

  @Get("boom")
  boom() {
    const error = new Error("database-password=do-not-expose");
    error.stack = "private stack trace";
    throw error;
  }
}

@Module({ controllers: [HttpBoundaryTestController] })
class HttpBoundaryTestModule {}

describe("common HTTP boundary", () => {
  let app: INestApplication;
  let baseUrl: string;
  const requestLogs: string[] = [];

  beforeAll(async () => {
    app = await NestFactory.create(HttpBoundaryTestModule, { logger: false });
    configureApplication(app, {
      frontendOrigin: "http://localhost:5173",
      requestLogWriter: (entry) => requestLogs.push(entry),
    });
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as AddressInfo | string | null;
    if (!address || typeof address === "string") throw new Error("HTTP boundary test server did not bind.");
    baseUrl = `http://127.0.0.1:${address.port}/${API_GLOBAL_PREFIX}`;
  });

  beforeEach(() => {
    requestLogs.length = 0;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("accepts a safe caller request ID and exposes the same value in the response", async () => {
    const requestId = "trace.ABC_123:-";
    const response = await fetch(`${baseUrl}/http-boundary/ok`, {
      headers: { [REQUEST_ID_HEADER]: requestId, Origin: "http://localhost:5173" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(requestId);
    expect(response.headers.get("access-control-expose-headers")).toContain(REQUEST_ID_HEADER);
    expect(findRequestLog(requestId)).toMatchObject({ requestId, method: "GET", statusCode: 200 });
  });

  it("replaces malformed or overlong request IDs with a UUID", async () => {
    for (const invalidRequestId of ["contains spaces", "x".repeat(129)]) {
      const response = await fetch(`${baseUrl}/http-boundary/ok`, {
        headers: { [REQUEST_ID_HEADER]: invalidRequestId },
      });
      const requestId = response.headers.get(REQUEST_ID_HEADER);

      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(requestId).not.toBe(invalidRequestId);
    }
  });

  it("preserves validation message arrays in the stable error envelope", async () => {
    const requestId = "validation-request";
    const response = await fetch(`${baseUrl}/http-boundary/validation?password=private`, {
      headers: { [REQUEST_ID_HEADER]: requestId },
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      statusCode: 400,
      message: ["loginId must not be empty", "password must be longer than or equal to 4 characters"],
      error: "Bad Request",
      code: "VALIDATION_ERROR",
      path: `/${API_GLOBAL_PREFIX}/http-boundary/validation`,
      requestId,
    });
    expect(body.timestamp).toEqual(expect.any(String));
  });

  it("maps expected conflicts and framework 404 responses without changing their messages", async () => {
    const conflict = await fetch(`${baseUrl}/http-boundary/conflict`);
    const conflictBody = (await conflict.json()) as Record<string, unknown>;
    const missing = await fetch(`${baseUrl}/missing-route?studentNo=1162001`);
    const missingBody = (await missing.json()) as Record<string, unknown>;

    expect(conflictBody).toMatchObject({
      statusCode: 409,
      message: "이미 등록된 값입니다.",
      code: "CONFLICT",
    });
    expect(missingBody).toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
      path: `/${API_GLOBAL_PREFIX}/missing-route`,
    });
  });

  it("never exposes unexpected error details or stacks in 500 responses", async () => {
    const response = await fetch(`${baseUrl}/http-boundary/boom`);
    const text = await response.text();
    const body = JSON.parse(text) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      statusCode: 500,
      message: "서버에서 요청을 처리하지 못했습니다.",
      code: "INTERNAL_ERROR",
    });
    expect(text).not.toContain("database-password");
    expect(text).not.toContain("private stack trace");
    expect(body).not.toHaveProperty("stack");
  });

  it("logs only the route template and the approved completion fields", async () => {
    const requestId = "safe-log-request";
    await fetch(`${baseUrl}/http-boundary/candidate/1162001?password=private`, {
      headers: {
        [REQUEST_ID_HEADER]: requestId,
        Authorization: "Bearer private-token",
      },
    });
    const serialized = requestLogs.find((line) => line.includes(requestId));
    const entry = findRequestLog(requestId);

    expect(Object.keys(entry)).toEqual(["method", "path", "statusCode", "durationMs", "requestId"]);
    expect(entry.path).toBe(`/${API_GLOBAL_PREFIX}/http-boundary/candidate/:studentNo`);
    expect(entry.durationMs).toEqual(expect.any(Number));
    expect(serialized).not.toContain("1162001");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("Authorization");
  });

  function findRequestLog(requestId: string): Record<string, unknown> {
    const serialized = requestLogs.find((line) => line.includes(requestId));
    if (!serialized) throw new Error(`No request completion log was captured for ${requestId}.`);
    return JSON.parse(serialized) as Record<string, unknown>;
  }
});
