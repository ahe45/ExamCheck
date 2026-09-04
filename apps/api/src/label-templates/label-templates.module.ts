import { Module } from "@nestjs/common";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { LabelTemplatesController } from "./label-templates.controller.js";
import { LabelTemplatesRepository } from "./label-templates.repository.js";
import { LabelTemplatesService } from "./label-templates.service.js";

@Module({
  controllers: [LabelTemplatesController],
  providers: [MutationAuditRepository, LabelTemplatesRepository, LabelTemplatesService],
})
export class LabelTemplatesModule {}
