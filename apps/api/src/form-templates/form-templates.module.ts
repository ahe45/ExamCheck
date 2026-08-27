import { Module } from "@nestjs/common";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { FormTemplatesController } from "./form-templates.controller.js";
import { FormTemplatesRepository } from "./form-templates.repository.js";
import { FormTemplatesService } from "./form-templates.service.js";

@Module({
  controllers: [FormTemplatesController],
  providers: [MutationAuditRepository, FormTemplatesRepository, FormTemplatesService],
  exports: [FormTemplatesService],
})
export class FormTemplatesModule {}
