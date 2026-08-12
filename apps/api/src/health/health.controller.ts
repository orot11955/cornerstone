import { Controller, Get } from '@nestjs/common';
import { HealthService, type HealthStatus } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  liveness(): HealthStatus {
    return this.health.liveness();
  }

  @Get('ready')
  readiness(): Promise<HealthStatus> {
    return this.health.readiness();
  }
}
