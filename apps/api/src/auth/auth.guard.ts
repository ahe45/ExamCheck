import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import type { JwtSessionConfig } from "../config/security-config.js";
import { AuthService } from "./auth.service.js";
import type { AuthenticatedUser } from "./auth.types.js";
import { verifySessionToken } from "./session-token.js";

export interface AuthenticatedRequest {
  headers: { authorization?: string };
  user: AuthenticatedUser;
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly secret: string;
  private readonly sessionConfig: JwtSessionConfig;

  constructor(
    @Inject(APP_CONFIG) config: Readonly<AppConfig>,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {
    this.secret = config.auth.jwtSecret;
    this.sessionConfig = config.auth.session;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    const claims = token ? verifySessionToken(token, this.secret, this.sessionConfig) : null;
    if (!claims) throw new UnauthorizedException("로그인이 필요합니다.");
    const sessionUser = await this.authService.findEnabledSessionUserById(claims.sub);
    if (!sessionUser || sessionUser.user.role !== claims.role || sessionUser.sessionVersion !== claims.sessionVersion) {
      throw new UnauthorizedException("로그인 정보가 만료되었습니다.");
    }
    request.user = sessionUser.user;
    return true;
  }
}
