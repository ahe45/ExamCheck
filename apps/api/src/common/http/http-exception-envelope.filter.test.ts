import { HttpStatus } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { mapErrorCode, type StableHttpErrorCode } from "./http-exception-envelope.filter.js";

describe("stable HTTP error codes", () => {
  it.each<[number, StableHttpErrorCode]>([
    [HttpStatus.BAD_REQUEST, "VALIDATION_ERROR"],
    [HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED"],
    [HttpStatus.FORBIDDEN, "FORBIDDEN"],
    [HttpStatus.NOT_FOUND, "NOT_FOUND"],
    [HttpStatus.CONFLICT, "CONFLICT"],
    [HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED"],
    [HttpStatus.I_AM_A_TEAPOT, "HTTP_ERROR"],
    [HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR"],
    [HttpStatus.SERVICE_UNAVAILABLE, "INTERNAL_ERROR"],
  ])("maps HTTP %i to %s", (statusCode, expectedCode) => {
    expect(mapErrorCode(statusCode)).toBe(expectedCode);
  });
});
