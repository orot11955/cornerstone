import { Injectable } from '@nestjs/common';
import { MetricsService } from '../observability/metrics.service.js';
import { getRequestContext } from '../observability/request-context.js';
import { StructuredLogger } from '../observability/structured-logger.service.js';

@Injectable()
export class DatabaseTelemetry {
  constructor(
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLogger,
  ) {}

  async observe<T>(operation: string, task: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
      const result = await task();
      this.record(operation, 'success', performance.now() - startedAt);
      return result;
    } catch (error: unknown) {
      this.record(
        operation,
        'failure',
        performance.now() - startedAt,
        databaseErrorType(error),
      );
      throw error;
    }
  }

  private record(
    operation: string,
    outcome: 'success' | 'failure',
    durationMs: number,
    errorType?: string,
  ): void {
    const context = getRequestContext();
    this.metrics.recordDatabase(operation, outcome, durationMs);
    this.logger.event(
      outcome === 'failure' ? 'error' : 'debug',
      'database.operation.completed',
      {
        operation,
        outcome,
        durationMs: Math.round(durationMs * 100) / 100,
        requestId: context?.requestId,
        traceId: context?.traceId,
        errorType,
      },
    );
  }
}

function databaseErrorType(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  const code = Reflect.get(error, 'code') as unknown;
  return typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code)
    ? code
    : error.name.replaceAll(/[^A-Za-z0-9_]/g, '').slice(0, 32) || 'unknown';
}
