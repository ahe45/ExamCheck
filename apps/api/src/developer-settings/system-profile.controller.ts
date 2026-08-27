import { Controller, Get, Inject } from "@nestjs/common";
import { DeveloperSettingsService } from "./developer-settings.service.js";

@Controller("system-profile")
export class SystemProfileController {
  constructor(@Inject(DeveloperSettingsService) private readonly settingsService: DeveloperSettingsService) {}

  @Get()
  get() {
    return this.settingsService.get();
  }
}
