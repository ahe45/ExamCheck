import { CandidateUploadService } from "./candidate-upload.service.js";
import { CandidateUploadRepository } from "./candidate-upload.repository.js";
import { Module } from "@nestjs/common";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { CandidatesApplicationService } from "./candidates.application.js";
import { CandidatesController } from "./candidates.controller.js";
import { CandidatesRepository } from "./candidates.repository.js";
import { CandidatesService } from "./candidates.service.js";

@Module({
  controllers: [CandidatesController],
  providers: [
    CandidatesRepository,
    CandidateUploadRepository,
    CandidateUploadService,
    MutationAuditRepository,
    CandidatesApplicationService,
    CandidatesService,
  ],
})
export class CandidatesModule {}
