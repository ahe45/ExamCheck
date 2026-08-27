import { Global, Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { AuthAuditService } from "./auth-audit.service.js";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthRepository } from "./auth.repository.js";
import { AuthService } from "./auth.service.js";
import { AUTH_LOGIN_ATTEMPT_LIMITER, LoginAttemptLimiter } from "./login-attempt-limiter.js";
import { RolesGuard } from "./roles.js";

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    AuthAuditService,
    AuthGuard,
    RolesGuard,
    {
      provide: AUTH_LOGIN_ATTEMPT_LIMITER,
      inject: [APP_CONFIG],
      useFactory: (config: Readonly<AppConfig>) => new LoginAttemptLimiter(config.auth.loginRateLimit),
    },
  ],
  exports: [AuthService, AuthGuard, RolesGuard],
})
export class AuthModule {}
