import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Pool } from "mysql2/promise";
import { getCurrentRequestId, isValidRequestId } from "../common/http/request-context.js";
import { DATABASE_POOL } from "../database/database.constants.js";

export type AuthAuditEventType = "AUTH_LOGIN_SUCCEEDED" | "AUTH_LOGIN_FAILED" | "AUTH_LOGIN_BLOCKED";

export type AuthAuditReason =
  "AUTHENTICATED" | "INVALID_CREDENTIALS" | "FAILURE_THRESHOLD_REACHED" | "RATE_LIMIT_ACTIVE";

interface AuthAuditDetailsByEvent {
  AUTH_LOGIN_SUCCEEDED: AuthAuditDetails<"AUTHENTICATED">;
  AUTH_LOGIN_FAILED: AuthAuditDetails<"INVALID_CREDENTIALS">;
  AUTH_LOGIN_BLOCKED: AuthAuditDetails<"FAILURE_THRESHOLD_REACHED" | "RATE_LIMIT_ACTIVE">;
}

export interface AuthAuditDetails<Reason extends AuthAuditReason = AuthAuditReason> {
  loginIdHash: string;
  ipHash: string;
  reason: Reason;
}

type AuthAuditActor<EventType extends AuthAuditEventType> = EventType extends "AUTH_LOGIN_SUCCEEDED"
  ? { actorUserId: number }
  : { actorUserId: number | null };

export type AuthAuditRecord = {
  [EventType in AuthAuditEventType]: AuthAuditActor<EventType> & {
    eventType: EventType;
    details: Readonly<AuthAuditDetailsByEvent[EventType]>;
  };
}[AuthAuditEventType];

interface NormalizedAuthAuditRecord {
  eventType: AuthAuditEventType;
  actorUserId: number | null;
  requestId: string | null;
  details: AuthAuditDetails;
}

const authAuditReasons = {
  AUTH_LOGIN_SUCCEEDED: new Set<AuthAuditReason>(["AUTHENTICATED"]),
  AUTH_LOGIN_FAILED: new Set<AuthAuditReason>(["INVALID_CREDENTIALS"]),
  AUTH_LOGIN_BLOCKED: new Set<AuthAuditReason>(["FAILURE_THRESHOLD_REACHED", "RATE_LIMIT_ACTIVE"]),
} as const satisfies Record<AuthAuditEventType, ReadonlySet<AuthAuditReason>>;

const authAuditKeys = new Set(["eventType", "actorUserId", "details"]);
const authAuditDetailKeys = new Set(["loginIdHash", "ipHash", "reason"]);
const sha256Pattern = /^[0-9a-f]{64}$/i;

@Injectable()
export class AuthAuditService {
  private readonly logger = new Logger(AuthAuditService.name);

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async record(record: AuthAuditRecord): Promise<boolean> {
    try {
      const normalized = normalizeAuthAuditRecord(record, getCurrentRequestId());
      await this.pool.execute(
        "INSERT INTO audit_log (event_type, actor_user_id, request_id, details) VALUES (?, ?, ?, ?)",
        [normalized.eventType, normalized.actorUserId, normalized.requestId, JSON.stringify(normalized.details)],
      );
      return true;
    } catch {
      this.logger.warn("로그인 감사 로그를 저장하지 못했습니다.");
      return false;
    }
  }
}

function normalizeAuthAuditRecord(
  input: AuthAuditRecord,
  inheritedRequestId: string | undefined,
): NormalizedAuthAuditRecord {
  if (!isPlainRecord(input) || hasUnexpectedKeys(input, authAuditKeys))
    throw new TypeError("Invalid auth audit record");
  if (!isAuthAuditEventType(input.eventType)) throw new TypeError("Invalid auth audit record");
  if (!(input.actorUserId === null || isPositiveInteger(input.actorUserId)))
    throw new TypeError("Invalid auth audit record");
  if (input.eventType === "AUTH_LOGIN_SUCCEEDED" && !isPositiveInteger(input.actorUserId)) {
    throw new TypeError("Invalid auth audit record");
  }

  const requestId = inheritedRequestId ?? null;
  if (!(requestId === null || isValidRequestId(requestId))) throw new TypeError("Invalid auth audit record");
  if (!isPlainRecord(input.details) || hasUnexpectedKeys(input.details, authAuditDetailKeys)) {
    throw new TypeError("Invalid auth audit record");
  }
  if (Object.keys(input.details).length !== authAuditDetailKeys.size) throw new TypeError("Invalid auth audit record");

  const { loginIdHash, ipHash, reason } = input.details;
  if (
    typeof loginIdHash !== "string" ||
    !sha256Pattern.test(loginIdHash) ||
    typeof ipHash !== "string" ||
    !sha256Pattern.test(ipHash) ||
    typeof reason !== "string" ||
    !authAuditReasons[input.eventType].has(reason as AuthAuditReason)
  ) {
    throw new TypeError("Invalid auth audit record");
  }

  return {
    eventType: input.eventType,
    actorUserId: input.actorUserId,
    requestId,
    details: {
      loginIdHash: loginIdHash.toLowerCase(),
      ipHash: ipHash.toLowerCase(),
      reason: reason as AuthAuditReason,
    },
  };
}

function isAuthAuditEventType(value: unknown): value is AuthAuditEventType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(authAuditReasons, value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasUnexpectedKeys(value: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).some((key) => !allowed.has(key));
}
