import { Module } from '@nestjs/common';
import { HealthModule } from './health.module.js';
import { GracefulShutdownCoordinator } from './graceful-shutdown.coordinator.js';

@Module({
  imports: [HealthModule],
  providers: [GracefulShutdownCoordinator],
  exports: [GracefulShutdownCoordinator],
})
export class GracefulShutdownModule {}
