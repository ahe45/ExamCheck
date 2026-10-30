import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Post,
  Put,
  StreamableFile,
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
import {
  ChangeDeveloperPasswordDto,
  UpdateDeveloperSettingsDto,
  UpdateHistoryResetPasswordDto,
} from "./developer-settings.dto.js";
import { DeveloperSettingsService } from "./developer-settings.service.js";
import { DatabaseBackupService } from "./database-backup.service.js";

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
  constructor(
    @Inject(DeveloperSettingsService) private readonly settingsService: DeveloperSettingsService,
    @Inject(DatabaseBackupService) private readonly backupService: DatabaseBackupService,
  ) {}

  @Get("backup")
  @Header("Cache-Control", "no-store")
  async backup() {
    return new StreamableFile(await this.backupService.backup(), {
      type: "application/gzip",
      disposition: `attachment; filename="examcheck-backup-${new Date().toISOString().replaceAll(":", "-")}.json.gz"`,
    });
  }

  @Post("restore")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 100 * 1024 * 1024, files: 1 } }))
  restore(
    @UploadedFile() file: LogoFile | undefined,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.backupService.restore(file?.buffer, body.password, body.confirmation, user.id);
  }

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.settingsService.getForUser(user);
  }

  @Get("history-reset-password")
  getHistoryResetPassword() {
    return this.settingsService.getHistoryResetPassword();
  }

  @Put("history-reset-password")
  updateHistoryResetPassword(@Body() input: UpdateHistoryResetPasswordDto, @CurrentUser() user: AuthenticatedUser) {
    return this.settingsService.updateHistoryResetPassword(input.newPassword, user);
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
