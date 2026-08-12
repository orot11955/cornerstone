import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { configuration } from './config/configuration';
import { validateEnvironment } from './config/env.schema';
import { ApiExceptionFilter } from './http/api-exception.filter';
import { MetricsService } from './observability/metrics.service';
import { RequestLoggingInterceptor } from './observability/request-logging.interceptor';
import { StructuredLogger } from './observability/structured-logger.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnvironment,
    }),
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
