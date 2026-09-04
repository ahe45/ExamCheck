import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { RequirePermissions } from "../auth/permissions.js";
import { RolesGuard } from "../auth/roles.js";
import {
  LabelTemplateCodeParamDto,
  PreviewLabelTemplateDto,
  SaveLabelTemplateDto,
  UpdateLabelTemplateActiveDto,
  UpdateLabelTemplateMetadataDto,
} from "./label-templates.dto.js";
import { LabelTemplatesService } from "./label-templates.service.js";

@Controller("label-templates")
@UseGuards(AuthGuard, RolesGuard)
@RequirePermissions("template.manage")
export class LabelTemplatesController {
  constructor(@Inject(LabelTemplatesService) private readonly service: LabelTemplatesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post("preview")
  preview(@Body() input: PreviewLabelTemplateDto) {
    return this.service.preview(input.layout);
  }

  @Put(":code")
  save(
    @Param() params: LabelTemplateCodeParamDto,
    @Body() input: SaveLabelTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.save({ ...input, code: params.code }, user);
  }

  @Patch(":code/metadata")
  updateMetadata(
    @Param() params: LabelTemplateCodeParamDto,
    @Body() input: UpdateLabelTemplateMetadataDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateMetadata(params.code, input, user);
  }

  @Patch(":code/active")
  updateActive(
    @Param() params: LabelTemplateCodeParamDto,
    @Body() input: UpdateLabelTemplateActiveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateActive(params.code, input, user);
  }

  @Delete(":code")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param() params: LabelTemplateCodeParamDto, @CurrentUser() user: AuthenticatedUser) {
    await this.service.remove(params.code, user);
  }
}
