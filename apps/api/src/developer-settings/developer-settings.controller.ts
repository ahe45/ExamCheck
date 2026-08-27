import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { RequirePermissions } from "../auth/permissions.js";
import { RolesGuard } from "../auth/roles.js";
import { ChangeDeveloperPasswordDto, UpdateDeveloperSettingsDto } from "./developer-settings.dto.js";
import { DeveloperSettingsService } from "./developer-settings.service.js";

interface LogoFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Controller("developer-settings")
@UseGuards(AuthGuard, RolesGuard)
@RequirePermissions("developer.manage")
export class DeveloperSettingsController {
  constructor(@Inject(DeveloperSettingsService) private readonly settingsService: DeveloperSettingsService) {}

  @Get()
  get() {
    return this.settingsService.get();
  }

  @Put()
  update(@Body() input: UpdateDeveloperSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.settingsService.update(input, user);
  }

  @Post("logo")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadLogo(@UploadedFile() file: LogoFile | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.settingsService.uploadLogo(file, user);
  }

  @Delete("logo")
  removeLogo(@CurrentUser() user: AuthenticatedUser) {
    return this.settingsService.removeLogo(user);
  }

  @Put("password")
  changePassword(@Body() input: ChangeDeveloperPasswordDto, @CurrentUser() user: AuthenticatedUser) {
    return this.settingsService.changePassword(input, user);
  }
}
