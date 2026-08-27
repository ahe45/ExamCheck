import { Module } from "@nestjs/common";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { PseudonymRosterExporter } from "./pseudonym-roster-exporter.js";
import {
  AssignPseudonymUseCase,
  ChangePseudonymOperationStatusUseCase,
  UpdatePseudonymSettingUseCase,
} from "./pseudonyms.application.js";
import { PseudonymsController } from "./pseudonyms.controller.js";
import { PseudonymsRepository } from "./pseudonyms.repository.js";
import { PseudonymsService } from "./pseudonyms.service.js";

@Module({
  controllers: [PseudonymsController],
  providers: [
    MutationAuditRepository,
    PseudonymRosterExporter,
    PseudonymsRepository,
    AssignPseudonymUseCase,
    ChangePseudonymOperationStatusUseCase,
    UpdatePseudonymSettingUseCase,
    PseudonymsService,
  ],
})
export class PseudonymsModule {}
