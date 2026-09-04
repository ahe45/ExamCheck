import { Body, Controller, Delete, Get, Inject, Post, Put, Query, StreamableFile, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { RequirePermissions } from "../auth/permissions.js";
import { RolesGuard } from "../auth/roles.js";
import {
  AssignPseudonymDto,
  DeleteAdmissionDto,
  ExportPseudonymRosterDto,
  PseudonymOperationScopeDto,
  PseudonymSettingQueryDto,
  PseudonymSettingsOverviewQueryDto,
  ResetAdmissionOperationsDto,
  UpdatePseudonymSettingDto,
} from "./pseudonyms.dto.js";
import { PseudonymsService } from "./pseudonyms.service.js";

@Controller("pseudonyms")
@UseGuards(AuthGuard, RolesGuard)
export class PseudonymsController {
  constructor(@Inject(PseudonymsService) private readonly pseudonymsService: PseudonymsService) {}

  @Get("settings-overview")
  @RequirePermissions("settings.manage")
  getSettingsOverview(@Query() query: PseudonymSettingsOverviewQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pseudonymsService.getSettingsOverview(query.examName, user);
  }

  @Get("setting")
  getSetting(@Query() query: PseudonymSettingQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pseudonymsService.getSetting(query.examName, query.admissionName, user);
  }

  @Put("setting")
  @RequirePermissions("settings.manage")
  updateSetting(@Body() input: UpdatePseudonymSettingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pseudonymsService.updateSetting(input, user);
  }

  @Get("admission-operation-schedules")
  @RequirePermissions("settings.manage")
  getAdmissionOperationSchedules(@Query() query: PseudonymSettingQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pseudonymsService.getAdmissionOperationSchedules(query.examName, query.admissionName, user);
  }

  @Post("admission-operations/reset")
  @RequirePermissions("settings.manage")
  resetAdmissionOperations(@Body() input: ResetAdmissionOperationsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pseudonymsService.resetAdmissionOperations(input, user);
  }

  @Delete("admission")
  @RequirePermissions("settings.manage")
  deleteAdmission(@Body() input: DeleteAdmissionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pseudonymsService.deleteAdmission(input, user);
  }

  @Post("assignments")
  @RequirePermissions("pseudonym.assign")
  assign(@Body() input: AssignPseudonymDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pseudonymsService.assign(input, user);
  }

  @Get("operations/status")
  operationStatus(@Query() input: PseudonymOperationScopeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pseudonymsService.getOperationStatus(input, user);
  }

  @Post("operations/export.xlsx")
  @RequirePermissions("operation.export")
  async exportOperationRoster(@Body() input: ExportPseudonymRosterDto, @CurrentUser() user: AuthenticatedUser) {
    return new StreamableFile(await this.pseudonymsService.buildOperationRosterExport(input, user), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent("가번호 등록 현황.xlsx")}`,
    });
  }

  @Post("operations/close")
  @RequirePermissions("operation.close")
  closeOperation(@Body() input: PseudonymOperationScopeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pseudonymsService.closeOperation(input, user);
  }

  @Post("operations/reopen")
  @RequirePermissions("operation.reopen")
  reopenOperation(@Body() input: PseudonymOperationScopeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pseudonymsService.reopenOperation(input, user);
  }
}
