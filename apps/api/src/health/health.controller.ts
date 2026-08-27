import { Controller, Get, Inject } from "@nestjs/common";
import { HealthService } from "./health.service.js";

@Controller("health")
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get()
  check() {
    return this.healthService.check();
  }

  @Get("live")
  live() {
    return this.healthService.liveness();
  }

  @Get("ready")
  ready() {
    return this.healthService.readiness();
  }
}
