import { Module } from "@nestjs/common";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { DeveloperSettingsController } from "./developer-settings.controller.js";
import { DeveloperSettingsRepository } from "./developer-settings.repository.js";
import { DeveloperSettingsService } from "./developer-settings.service.js";
import { SystemProfileController } from "./system-profile.controller.js";

@Module({
  controllers: [DeveloperSettingsController, SystemProfileController],
  providers: [MutationAuditRepository, DeveloperSettingsRepository, DeveloperSettingsService],
})
export class DeveloperSettingsModule {}
