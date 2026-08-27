import { Module } from "@nestjs/common";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { WorkstationsController } from "./workstations.controller.js";
import { WorkstationsRepository } from "./workstations.repository.js";
import { WorkstationsService } from "./workstations.service.js";

@Module({
  controllers: [WorkstationsController],
  providers: [WorkstationsService, WorkstationsRepository, MutationAuditRepository],
})
export class WorkstationsModule {}
