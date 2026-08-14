import { randomUUID } from 'node:crypto';
import { getRequestContext } from '../observability/request-context.js';
import { MetricsService } from '../observability/metrics.service.js';
import { StructuredLogger } from '../observability/structured-logger.service.js';
import {
  OutboundHttpClient,
  OutboundRequestError,
  type OutboundResponse,
} from './outbound-http.client.js';

export interface OutboundHttpPort {
  request(
    path: string,
    init?: Omit<RequestInit, 'redirect' | 'signal'> & {
      readonly signal?: AbortSignal;
    },
  ): Promise<OutboundResponse>;
}

export class ObservedOutboundHttpClient implements OutboundHttpPort {
  constructor(
    private readonly client: OutboundHttpClient,
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLogger,
  ) {}

  async request(
    path: string,
    init: Omit<RequestInit, 'redirect' | 'signal'> & {
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<OutboundResponse> {
    const startedAt = performance.now();
    try {
      const response = await this.client.request(path, {
        ...init,
        headers: this.withRequestContext(init.headers),
      });
      this.metrics.recordOutboundHttp(
        'outbound.request',
        'success',
        performance.now() - startedAt,
      );
      return response;
    } catch (error) {
      this.metrics.recordOutboundHttp(
        'outbound.request',
        'failure',
        performance.now() - startedAt,
      );
      this.logger.event('warn', 'outbound.request.failed', {
        operation: 'outbound.request',
        outcome: error instanceof OutboundRequestError ? error.code : 'UNKNOWN',
      });
      throw error;
    }
  }

  private withRequestContext(headers: RequestInit['headers']): Headers {
    const result = new Headers(headers);
    const context = getRequestContext();
    if (!context) return result;
    if (!result.has('x-request-id'))
      result.set('x-request-id', context.requestId);
    if (!result.has('traceparent')) {
      result.set(
        'traceparent',
        `00-${context.traceId}-${randomUUID().replaceAll('-', '').slice(0, 16)}-01`,
      );
    }
    return result;
  }
}
