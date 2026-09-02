import { Body, Controller, Inject, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { RequirePermissions } from "../auth/permissions.js";
import { RolesGuard } from "../auth/roles.js";
import { CompletePrintJobDto, CreatePrintJobDto, ReissuePrintJobDto } from "./print-jobs.dto.js";
import { PrintJobsService } from "./print-jobs.service.js";

@Controller("print-jobs")
@UseGuards(AuthGuard, RolesGuard)
@RequirePermissions("print.create")
export class PrintJobsController {
  constructor(@Inject(PrintJobsService) private readonly printJobsService: PrintJobsService) {}

  @Post()
  create(@Body() input: CreatePrintJobDto, @CurrentUser() user: AuthenticatedUser) {
    return this.printJobsService.create(input, user);
  }

  @Post(":id/result")
  complete(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() input: CompletePrintJobDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.printJobsService.complete(id, input, user);
  }

  @Post(":id/reissue")
  reissue(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() input: ReissuePrintJobDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.printJobsService.reissue(id, input, user);
  }
}
