import { DynamicModule, Module } from '@nestjs/common';
import { MetricsService } from '../observability/metrics.service.js';
import { StructuredLogger } from '../observability/structured-logger.service.js';
import { ObservedOutboundHttpClient } from './outbound-http.adapter.js';
import {
  OutboundHttpClient,
  type OutboundHttpClientOptions,
} from './outbound-http.client.js';

export const OUTBOUND_HTTP_CLIENT = Symbol('OUTBOUND_HTTP_CLIENT');

@Module({})
export class OutboundHttpModule {
  static register(options: OutboundHttpClientOptions): DynamicModule {
    return {
      module: OutboundHttpModule,
      providers: [
        {
          provide: OUTBOUND_HTTP_CLIENT,
          inject: [MetricsService, StructuredLogger],
          useFactory: (metrics: MetricsService, logger: StructuredLogger) =>
            new ObservedOutboundHttpClient(
              new OutboundHttpClient(options),
              metrics,
              logger,
            ),
        },
      ],
      exports: [OUTBOUND_HTTP_CLIENT],
    };
  }
}
