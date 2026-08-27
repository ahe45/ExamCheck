import { type DynamicModule, Module } from "@nestjs/common";
import type { AppConfig } from "./config/app-config.js";
import { AppConfigModule } from "./config/app-config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { DriversModule } from "./drivers/drivers.module.js";
import { ExamineesModule } from "./examinees/examinees.module.js";
import { FormTemplatesModule } from "./form-templates/form-templates.module.js";
import { HealthModule } from "./health/health.module.js";
import { PrintJobsModule } from "./print-jobs/print-jobs.module.js";
import { PseudonymsModule } from "./pseudonyms/pseudonyms.module.js";
import { WorkstationsModule } from "./workstations/workstations.module.js";
import { CandidatesModule } from "./candidates/candidates.module.js";
import { AccountsModule } from "./accounts/accounts.module.js";
import { DeveloperSettingsModule } from "./developer-settings/developer-settings.module.js";

@Module({})
export class AppModule {
  static forRoot(config: Readonly<AppConfig>): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        DatabaseModule,
        AuthModule,
        DriversModule,
        ExamineesModule,
        FormTemplatesModule,
        HealthModule,
        PrintJobsModule,
        PseudonymsModule,
        WorkstationsModule,
        CandidatesModule,
        AccountsModule,
        DeveloperSettingsModule,
      ],
    };
  }
}
