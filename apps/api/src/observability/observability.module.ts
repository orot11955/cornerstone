import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service.js';
import { StructuredLogger } from './structured-logger.service.js';

@Global()
@Module({
  providers: [
    MetricsService,
    { provide: StructuredLogger, useFactory: () => new StructuredLogger() },
  ],
  exports: [MetricsService, StructuredLogger],
})
export class ObservabilityModule {}
