import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validateDatabaseEnvironment } from '../config/env.schema.js';
import { ObservabilityModule } from '../observability/observability.module.js';
import { DatabaseTelemetry } from './database-telemetry.js';
import { buildDatabaseOptions } from './database-options.js';
import { IdempotencyRepository } from './idempotency.repository.js';
import { OutboxRepository } from './outbox.repository.js';

@Global()
@Module({
  imports: [
    ObservabilityModule,
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...buildDatabaseOptions(
          validateDatabaseEnvironment(process.env),
          'runtime',
        ),
        retryAttempts: 0,
      }),
    }),
  ],
  providers: [DatabaseTelemetry, IdempotencyRepository, OutboxRepository],
  exports: [
    TypeOrmModule,
    DatabaseTelemetry,
    IdempotencyRepository,
    OutboxRepository,
  ],
})
export class DatabaseModule {}
