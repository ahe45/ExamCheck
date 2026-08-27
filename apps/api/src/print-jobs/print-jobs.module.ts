import { Module } from "@nestjs/common";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { PrintJobsController } from "./print-jobs.controller.js";
import { PrintJobsRepository } from "./print-jobs.repository.js";
import { PrintJobsService } from "./print-jobs.service.js";

@Module({
  controllers: [PrintJobsController],
  providers: [MutationAuditRepository, PrintJobsRepository, PrintJobsService],
})
export class PrintJobsModule {}
