import { Body, Controller, Get, Inject, Ip, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "./auth.guard.js";
import { CurrentUser } from "./current-user.js";
import { LoginDto } from "./auth.dto.js";
import { AuthService } from "./auth.service.js";
import type { AuthenticatedUser } from "./auth.types.js";

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post("login")
  login(@Body() input: LoginDto, @Ip() clientIp: string) {
    return this.authService.login(input.loginId, input.password, clientIp);
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
