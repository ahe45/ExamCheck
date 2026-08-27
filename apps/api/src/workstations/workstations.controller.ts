import { Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { RequirePermissions } from "../auth/permissions.js";
import { RolesGuard } from "../auth/roles.js";
import { CreateWorkstationDto } from "./workstations.dto.js";
import { WorkstationsService } from "./workstations.service.js";

@Controller("workstations")
@UseGuards(AuthGuard, RolesGuard)
export class WorkstationsController {
  constructor(@Inject(WorkstationsService) private readonly workstationsService: WorkstationsService) {}

  @Get()
  list() {
    return this.workstationsService.list();
  }

  @Post()
  @RequirePermissions("workstation.manage")
  create(@Body() input: CreateWorkstationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.workstationsService.create(input, user.id);
  }
}
