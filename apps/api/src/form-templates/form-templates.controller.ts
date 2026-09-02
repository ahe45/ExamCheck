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
  Put,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { RequirePermissions } from "../auth/permissions.js";
import { RolesGuard } from "../auth/roles.js";
import {
  FormTemplateCodeParamDto,
  SaveFormTemplateDto,
  UpdateFormTemplateActiveDto,
  UpdateFormTemplateMetadataDto,
} from "./form-templates.dto.js";
import { FormTemplatesService } from "./form-templates.service.js";

@Controller("form-templates")
@UseGuards(AuthGuard, RolesGuard)
export class FormTemplatesController {
  constructor(@Inject(FormTemplatesService) private readonly formTemplatesService: FormTemplatesService) {}

  @Get("data-tags")
  getDataTags() {
    return this.formTemplatesService.getDataTags();
  }

  @Get("admin")
  @RequirePermissions("template.manage")
  listForAdmin() {
    return this.formTemplatesService.list(false);
  }

  @Get()
  listActive() {
    return this.formTemplatesService.list(true);
  }

  @Get(":code")
  findActive(@Param() params: FormTemplateCodeParamDto) {
    return this.formTemplatesService.findActive(params.code);
  }

  @Put(":code")
  @RequirePermissions("template.manage")
  save(
    @Param() params: FormTemplateCodeParamDto,
    @Body() input: SaveFormTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.formTemplatesService.save({ ...input, code: params.code }, user);
  }

  @Patch(":code/metadata")
  @RequirePermissions("template.manage")
  updateMetadata(
    @Param() params: FormTemplateCodeParamDto,
    @Body() input: UpdateFormTemplateMetadataDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.formTemplatesService.updateMetadata(params.code, input, user);
  }

  @Patch(":code/active")
  @RequirePermissions("template.manage")
  updateActive(
    @Param() params: FormTemplateCodeParamDto,
    @Body() input: UpdateFormTemplateActiveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.formTemplatesService.updateActive(params.code, input, user);
  }

  @Delete(":code")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions("template.manage")
  async remove(@Param() params: FormTemplateCodeParamDto, @CurrentUser() user: AuthenticatedUser) {
    await this.formTemplatesService.remove(params.code, user);
  }
}
