import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { configuration } from './config/configuration.js';
import { validateEnvironment } from './config/env.schema.js';
import { ApiExceptionFilter } from './http/api-exception.filter.js';
import { HealthModule } from './health/health.module.js';
import { MetricsService } from './observability/metrics.service.js';
import { RequestLoggingInterceptor } from './observability/request-logging.interceptor.js';
import { StructuredLogger } from './observability/structured-logger.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnvironment,
    }),
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    MetricsService,
    { provide: StructuredLogger, useFactory: () => new StructuredLogger() },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class AppModule {}
