import { Global, Module } from "@nestjs/common";
import { IdentityBackfillProjectionRepository } from "../database/identity-backfill-projection.repository.js";
import { IdentityReadRouter } from "./identity-read-router.js";
import { IdentityShadowObservationRepository } from "./identity-shadow-observation.repository.js";
import { IdentityTransitionCoordinator } from "./identity-transition-coordinator.js";
import { IdentityTransitionStateRepository } from "./identity-transition-state.js";

@Global()
@Module({
  providers: [
    IdentityTransitionStateRepository,
    IdentityTransitionCoordinator,
    IdentityShadowObservationRepository,
    IdentityReadRouter,
    IdentityBackfillProjectionRepository,
  ],
  exports: [
    IdentityTransitionStateRepository,
    IdentityTransitionCoordinator,
    IdentityShadowObservationRepository,
    IdentityReadRouter,
    IdentityBackfillProjectionRepository,
  ],
})
export class IdentityTransitionModule {}
