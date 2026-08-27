import { Controller, Get, Inject, Param, Query, StreamableFile, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { ExamineeNumberParamDto, OperationScheduleQueryDto } from "./examinees.dto.js";
import { ExamineesService } from "./examinees.service.js";

@Controller("examinees")
@UseGuards(AuthGuard)
export class ExamineesController {
  constructor(@Inject(ExamineesService) private readonly examineesService: ExamineesService) {}

  @Get("operation/schedules")
  schedules(@CurrentUser() user: AuthenticatedUser) {
    return this.examineesService.listSchedules(user);
  }

  @Get("operation/roster")
  roster(@Query() query: OperationScheduleQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.examineesService.listRoster(query, user);
  }

  @Get("operation/lookup/:examineeNo")
  lookup(
    @Param() params: ExamineeNumberParamDto,
    @Query() query: OperationScheduleQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examineesService.lookupByNumber(params.examineeNo, query, user);
  }

  @Get(":examineeNo/photo")
  async photo(
    @Param() params: ExamineeNumberParamDto,
    @Query() query: OperationScheduleQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const photo = await this.examineesService.findPhotoByNumber(params.examineeNo, query, user);
    return new StreamableFile(photo.content, { type: photo.mimeType, disposition: "inline" });
  }

  @Get(":examineeNo")
  findOne(
    @Param() params: ExamineeNumberParamDto,
    @Query() query: OperationScheduleQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examineesService.findActiveByNumber(params.examineeNo, query, user);
  }
}
