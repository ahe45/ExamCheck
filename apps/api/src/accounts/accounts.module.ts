import { Module } from "@nestjs/common";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { AccountsApplicationService } from "./accounts.application.js";
import { AccountsController } from "./accounts.controller.js";
import { AccountsRepository } from "./accounts.repository.js";
import { AccountsService } from "./accounts.service.js";

@Module({
  controllers: [AccountsController],
  providers: [AccountsRepository, MutationAuditRepository, AccountsApplicationService, AccountsService],
})
export class AccountsModule {}
