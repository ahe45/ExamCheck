import { Module } from "@nestjs/common";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { CandidatesApplicationService } from "./candidates.application.js";
import { CandidateIdentityRepository } from "./candidate-identity.repository.js";
import { CandidatesController } from "./candidates.controller.js";
import { CandidatesRepository } from "./candidates.repository.js";
import { CandidatesService } from "./candidates.service.js";

@Module({
  controllers: [CandidatesController],
  providers: [
    CandidatesRepository,
    CandidateIdentityRepository,
    MutationAuditRepository,
    CandidatesApplicationService,
    CandidatesService,
  ],
})
export class CandidatesModule {}
