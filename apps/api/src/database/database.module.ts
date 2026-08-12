import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validateDatabaseEnvironment } from '../config/env.schema.js';
import { AuthAuditRepository } from '../auth/auth-audit.repository.js';
import { AuthMailOutboxService } from '../auth/auth-mail-outbox.service.js';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service.js';
import { AuthCryptoModule } from '../auth/auth-crypto.module.js';
import { ObservabilityModule } from '../observability/observability.module.js';
import { DatabaseTelemetry } from './database-telemetry.js';
import { buildDatabaseOptions } from './database-options.js';
import { IdempotencyRepository } from './idempotency.repository.js';
import { OutboxRepository } from './outbox.repository.js';

@Global()
@Module({
  imports: [
    ObservabilityModule,
    AuthCryptoModule,
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
  providers: [
    DatabaseTelemetry,
    IdempotencyRepository,
    OutboxRepository,
    AuthAuditRepository,
    AuthMailOutboxService,
    AuthRateLimitService,
  ],
  exports: [
    TypeOrmModule,
    DatabaseTelemetry,
    IdempotencyRepository,
    OutboxRepository,
    AuthAuditRepository,
    AuthMailOutboxService,
    AuthRateLimitService,
  ],
})
export class DatabaseModule {}
