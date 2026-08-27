import { HttpException, HttpStatus, Inject, Injectable, Logger, Optional, UnauthorizedException } from "@nestjs/common";
import type { Pool } from "mysql2/promise";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import type { JwtSessionConfig } from "../config/security-config.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import { AuthAuditService, type AuthAuditRecord } from "./auth-audit.service.js";
import { AuthRepository, type AuthUserRow } from "./auth.repository.js";
import type { AuthenticatedSessionUser, AuthenticatedUser } from "./auth.types.js";
import {
  AUTH_LOGIN_ATTEMPT_LIMITER,
  createLoginAttemptIdentity,
  LoginAttemptLimiter,
  normalizeLoginId,
} from "./login-attempt-limiter.js";
import { verifyPassword } from "./password.js";
import { createSessionToken } from "./session-token.js";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly secret: string;
  private readonly sessionConfig: JwtSessionConfig;
  private readonly repository: AuthRepository;

  constructor(
    @Inject(DATABASE_POOL) pool: Pool,
    @Inject(APP_CONFIG) config: Readonly<AppConfig>,
    @Inject(AUTH_LOGIN_ATTEMPT_LIMITER) private readonly loginAttemptLimiter: LoginAttemptLimiter,
    @Inject(AuthAuditService) private readonly authAudit: AuthAuditService,
    @Optional() @Inject(AuthRepository) repository?: AuthRepository,
  ) {
    this.secret = config.auth.jwtSecret;
    this.sessionConfig = config.auth.session;
    this.repository = repository ?? new AuthRepository(pool);
  }

  async login(loginId: string, password: string, clientIdentifier?: string) {
    const normalizedLoginId = normalizeLoginId(loginId);
    const identity = createLoginAttemptIdentity(normalizedLoginId, clientIdentifier);
    const currentStatus = this.loginAttemptLimiter.check(identity.key);
    if (currentStatus.blocked) {
      await this.recordAuditSafely({
        eventType: "AUTH_LOGIN_BLOCKED",
        actorUserId: null,
        details: {
          loginIdHash: identity.loginIdHash,
          ipHash: identity.ipHash,
          reason: "RATE_LIMIT_ACTIVE",
        },
      });
      throw tooManyLoginAttempts();
    }

    const user = await this.findUserByLoginId(normalizedLoginId);
    if (!user || !user.enabled || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      const failureStatus = this.loginAttemptLimiter.registerFailure(identity.key);
      await this.recordAuditSafely({
        eventType: "AUTH_LOGIN_FAILED",
        actorUserId: user?.id ?? null,
        details: {
          loginIdHash: identity.loginIdHash,
          ipHash: identity.ipHash,
          reason: "INVALID_CREDENTIALS",
        },
      });
      if (failureStatus.blocked) {
        await this.recordAuditSafely({
          eventType: "AUTH_LOGIN_BLOCKED",
          actorUserId: user?.id ?? null,
          details: {
            loginIdHash: identity.loginIdHash,
            ipHash: identity.ipHash,
            reason: "FAILURE_THRESHOLD_REACHED",
          },
        });
        throw tooManyLoginAttempts();
      }
      throw new UnauthorizedException("아이디 또는 비밀번호가 올바르지 않습니다.");
    }
    const publicUser = await this.toAuthenticatedUser(user);
    this.loginAttemptLimiter.reset(identity.key);
    await this.recordAuditSafely({
      eventType: "AUTH_LOGIN_SUCCEEDED",
      actorUserId: user.id,
      details: {
        loginIdHash: identity.loginIdHash,
        ipHash: identity.ipHash,
        reason: "AUTHENTICATED",
      },
    });
    return {
      token: createSessionToken(
        { userId: user.id, role: user.role, sessionVersion: Number(user.sessionVersion) },
        this.secret,
        this.sessionConfig,
      ),
      user: publicUser,
    };
  }

  async findEnabledUserById(id: number): Promise<AuthenticatedUser | null> {
    return (await this.findEnabledSessionUserById(id))?.user ?? null;
  }

  async findEnabledSessionUserById(id: number): Promise<AuthenticatedSessionUser | null> {
    const user = await this.repository.findUserById(id);
    if (!user || !user.enabled) return null;
    return {
      user: await this.toAuthenticatedUser(user),
      sessionVersion: Number(user.sessionVersion),
    };
  }

  private findUserByLoginId(loginId: string): Promise<AuthUserRow | null> {
    return this.repository.findUserByLoginId(loginId);
  }

  private async toAuthenticatedUser(row: AuthUserRow): Promise<AuthenticatedUser> {
    const admissionNames = await this.repository.listAdmissionNames(row.id);
    return {
      id: row.id,
      loginId: row.loginId,
      role: row.role,
      admissionNames,
    };
  }

  private async recordAuditSafely(record: AuthAuditRecord): Promise<void> {
    try {
      await this.authAudit.record(record);
    } catch {
      this.logger.warn("로그인 감사 기록 처리 중 오류가 발생했습니다.");
    }
  }
}

function tooManyLoginAttempts(): HttpException {
  return new HttpException("로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.", HttpStatus.TOO_MANY_REQUESTS);
}
