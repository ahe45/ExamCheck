import { Body, Controller, Delete, Get, Inject, Param, ParseIntPipe, Post, Put, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { RequirePermissions } from "../auth/permissions.js";
import { RolesGuard } from "../auth/roles.js";
import { CreateAccountDto, UpdateAccountDto } from "./accounts.dto.js";
import { AccountsService } from "./accounts.service.js";

@Controller("accounts")
@UseGuards(AuthGuard, RolesGuard)
@RequirePermissions("account.manage")
export class AccountsController {
  constructor(@Inject(AccountsService) private readonly accountsService: AccountsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.accountsService.list(user.classificationMethod ?? "ADMISSION");
  }

  @Get("admissions")
  admissions() {
    return this.accountsService.admissions();
  }

  @Get("classification-scopes")
  classificationScopes(@CurrentUser() user: AuthenticatedUser) {
    return this.accountsService.classificationScopes(user.classificationMethod ?? "ADMISSION");
  }

  @Post()
  create(@Body() input: CreateAccountDto, @CurrentUser() user: AuthenticatedUser) {
    return this.accountsService.create(input, user);
  }

  @Put(":id")
  update(
    @Param("id", ParseIntPipe) id: number,
    @Body() input: UpdateAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountsService.update(id, input, user);
  }

  @Delete(":id")
  remove(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.accountsService.remove(id, user);
  }
}
