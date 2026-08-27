import {
  ForbiddenException,
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedRequest } from "./auth.guard.js";
import type { UserRole } from "./auth.types.js";
import { hasEveryPermission, PERMISSIONS_KEY, type Permission } from "./permissions.js";

const ROLES_KEY = "examcheck_roles";
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const permissions = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets);
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (permissions?.length) {
      if (user && hasEveryPermission(user.role, permissions)) return true;
      throw new ForbiddenException("이 기능을 사용할 권한이 없습니다.");
    }

    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets);
    if (!roles?.length) return true;
    if (user?.role === "DEVELOPER") return true;
    if (user && roles.includes(user.role)) return true;
    throw new ForbiddenException("이 기능을 사용할 권한이 없습니다.");
  }
}
